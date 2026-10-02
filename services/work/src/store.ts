import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { actionSchema, extractionSchema, type Action, type Source, type WorkItem, type ScanState } from './model.js';
const digest = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 32);
const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const key = (s: string) => normalize(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const fingerprint = (sources: Source[]) => digest(JSON.stringify(sources));
export class WorkStore {
    #db: DatabaseSync;
    constructor(path: string) {
        if (path !== ':memory:')
            mkdirSync(dirname(path), { recursive: true });
        this.#db = new DatabaseSync(path);
        this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(account_id,fingerprint));
      CREATE TABLE IF NOT EXISTS undo(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scans(key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
    }
    close() { this.#db.close(); }
    state(): ScanState { const row = this.#db.prepare('SELECT payload FROM state WHERE key=?').get('scan'); return row ? JSON.parse(String(row.payload)) : { enabled: false, running: false, scanned: 0, total: 0, depth: 30, lastScan: null, error: null, failures: 0 }; }
    setState(patch: Partial<ScanState>) { const state = { ...this.state(), ...patch }; this.#db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run('scan', JSON.stringify(state)); return state; }
    seen(key: string, value: string) { return this.#db.prepare('SELECT fingerprint FROM scans WHERE key=?').get(key)?.fingerprint === value; }
    all(account?: string): WorkItem[] {
        const rows = account ? this.#db.prepare('SELECT payload FROM items WHERE account_id=?').all(account) : this.#db.prepare('SELECT payload FROM items').all();
        return rows.map(r => JSON.parse(String(r.payload)) as WorkItem).map(item => item.status === 'snoozed' && item.snoozedUntil && item.snoozedUntil <= new Date().toISOString() ? { ...item, status: 'open', snoozedUntil: null } : item);
    }
    get(id: string): WorkItem|undefined {
        const row=this.#db.prepare('SELECT payload FROM items WHERE id=?').get(id);if(!row)return undefined;
        const item=JSON.parse(String(row.payload)) as WorkItem;
        return item.status==='snoozed'&&item.snoozedUntil&&item.snoozedUntil<=new Date().toISOString()?{...item,status:'open',snoozedUntil:null}:item;
    }
    #put(item: WorkItem, fp?: string) {
        if (fp)
            this.#db.prepare('INSERT INTO items VALUES(?,?,?,?)').run(item.id, item.accountId, fp, JSON.stringify(item));
        else
            this.#db.prepare('UPDATE items SET payload=? WHERE id=?').run(JSON.stringify(item), item.id);
    }
    action(id: string, raw: Action): WorkItem {
        const patch = actionSchema.parse(raw), item = this.get(id);
        if (!item)
            throw Object.assign(new Error('This to-do no longer exists.'), { status: 404 });
        if (item.revision !== patch.revision)
            throw Object.assign(new Error('This to-do changed. Review the latest version and try again.'), { status: 409 });
        if (patch.status === 'snoozed' && (!patch.snoozedUntil || Date.parse(patch.snoozedUntil) <= Date.now()))
            throw new Error('Choose a future snooze time.');
        if (patch.due && (Number.isNaN(Date.parse(patch.due)) || new Date(patch.due).toISOString().slice(0, 10) !== patch.due))
            throw new Error('Choose a valid due date.');
        const next = { ...item, ...patch, revision: item.revision + 1, userEdited: true, overrides: [...new Set([...(item.overrides ?? []), ...Object.keys(patch).filter(k=>k!=='revision'), ...(patch.status ? ['snoozedUntil'] : [])])], updatedAt: new Date().toISOString(), snoozedUntil: patch.status === 'snoozed' ? patch.snoozedUntil! : patch.status ? null : item.snoozedUntil };
        this.#db.exec('BEGIN IMMEDIATE');
        try {this.#db.prepare('INSERT OR REPLACE INTO undo VALUES(?,?,?)').run(id,next.revision,JSON.stringify(item));this.#put(next);this.#db.exec('COMMIT')}
        catch(error){this.#db.exec('ROLLBACK');throw error}
        return next;
    }
    undo(id:string,revision:unknown):WorkItem {
        if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1)throw new Error('A valid revision is required.');
        const current=this.get(id),snapshot=this.#db.prepare('SELECT revision,payload FROM undo WHERE id=?').get(id);
        if(!current||current.revision!==revision||snapshot?.revision!==revision)throw Object.assign(new Error('This to-do changed. Undo is no longer available.'),{status:409});
        const restored={...JSON.parse(String(snapshot.payload)) as WorkItem,revision:revision+1,updatedAt:new Date().toISOString()};
        this.#db.exec('BEGIN IMMEDIATE');
        try{this.#put(restored);this.#db.prepare('DELETE FROM undo WHERE id=?').run(id);this.#db.exec('COMMIT')}
        catch(error){this.#db.exec('ROLLBACK');throw error}
        return restored;
    }
    /** Validate the complete proposal before a transaction: no partial writes or invented evidence. */
    reconcile(accountId: string, scanKey: string, sources: Source[], raw: unknown): number {
        const { items } = extractionSchema.parse(raw);
        if (sources.some(s => s.accountId !== accountId))
            throw new Error('Source account mismatch');
        const bySource = new Map(sources.map(s => [s.id, s])), existing = this.all(accountId);
        const allowedContacts = new Set(sources.flatMap(s => s.participants));
        const self = sources.find(s => s.accountEmail)?.accountEmail;
        const proposals = items.map(c => {
            if (c.owner && !allowedContacts.has(c.owner))
                throw new Error('Owner is absent from the sources');
            if (c.contacts.some(email => !allowedContacts.has(email)))
                throw new Error('Contact is absent from the sources');
            if (c.due && (Number.isNaN(Date.parse(c.due)) || new Date(c.due).toISOString().slice(0, 10) !== c.due))
                throw new Error('Invalid due date');
            const evidence = c.evidence.map(e => { const source = bySource.get(e.sourceId); if (!source || !normalize(source.text).includes(normalize(e.quote)))
                throw new Error('The quoted evidence was not found in its source'); return { source: { ...source, text: '' }, quote: normalize(e.quote) }; });
            const previous = c.existingId ? existing.find(i => i.id === c.existingId) : undefined;
            if (c.existingId && (!previous || previous.kind !== c.kind || !previous.contacts.some(e => e !== self && allowedContacts.has(e))))
                throw new Error('The existing item does not belong to this context');
            return { c, evidence, previous };
        });
        this.#db.exec('BEGIN IMMEDIATE');
        try {
            for (const { c, evidence, previous } of proposals) {
                const fp = digest(`${c.kind}:${key(c.title)}:${[...c.contacts].sort().join(',')}`);
                const row = this.#db.prepare('SELECT payload FROM items WHERE account_id=? AND fingerprint=?').get(accountId, fp);
                const old = (previous ? this.get(previous.id) : undefined) ?? (row ? JSON.parse(String(row.payload)) as WorkItem : undefined);
                const item: WorkItem = { id: old?.id ?? digest(`${accountId}:${fp}`), accountId, accountEmail: sources.find(s => s.accountEmail)?.accountEmail, kind: c.kind, title: c.title, summary: c.summary,
                    topic: c.topic, topicId: digest(`${accountId}:${key(c.topic)}`), contacts: [...new Set([...(old?.contacts ?? []), ...c.contacts])], owner: c.owner, due: c.due,
                    status: c.kind === 'task' && c.status === 'open' && c.owner && self && c.owner !== self ? 'waiting' : c.status, certainty: c.certainty, snoozedUntil: null, userEdited: false, revision: (old?.revision ?? 0) + 1, updatedAt: new Date().toISOString(),
                    evidence: [...new Map([...(old?.evidence ?? []), ...evidence].map(e => [`${e.source.id}:${e.quote}`, e])).values()].slice(-50) };
                const latest = (list: typeof evidence) => list.reduce((date, e) => e.source.at > date ? e.source.at : date, '');
                if (old && latest(evidence) < latest(old.evidence))
                    Object.assign(item, { title: old.title, summary: old.summary, topic: old.topic, topicId: old.topicId, owner: old.owner, due: old.due, status: old.status, certainty: old.certainty });
                // User decisions take precedence forever; AI can add evidence without undoing them.
                if (old?.userEdited) {
                    const fields=old.overrides ?? ['title','owner','due','status','certainty','snoozedUntil'];
                    for(const field of fields)if(['title','owner','due','status','certainty','snoozedUntil'].includes(field))Object.assign(item,{[field]:old[field as keyof WorkItem]});
                    item.userEdited=true;item.overrides=fields;
                }
                this.#put(item, old ? undefined : fp);
            }
            this.#db.prepare('INSERT OR REPLACE INTO scans VALUES(?,?)').run(scanKey, fingerprint(sources));
            this.#db.exec('COMMIT');
            return proposals.length;
        }
        catch (e) {
            this.#db.exec('ROLLBACK');
            throw e;
        }
    }
    context(query:URLSearchParams) {
        const items=this.all(query.get('account')||undefined).filter(i=>(!query.get('contact')||i.contacts.includes(query.get('contact')!.toLowerCase()))&&(!query.get('topic')||i.topicId===query.get('topic')))
            .sort((a,b)=>Number(['done','dismissed'].includes(a.status))-Number(['done','dismissed'].includes(b.status))||b.updatedAt.localeCompare(a.updatedAt));
        return {total:items.length,returned:Math.min(items.length,80),limited:items.length>80,items:items.slice(0,80).map(i=>({...i,summary:i.summary.slice(0,800),evidence:i.evidence.slice(-2).map(e=>({...e,quote:e.quote.slice(0,500)}))}))};
    }
    view(query: URLSearchParams, now = new Date()) {
        let items = this.all(query.get('account') || undefined);
        const contact = query.get('contact'), topic = query.get('topic'), thread = query.get('thread'), filter = query.get('filter') ?? 'all';
        if (contact)
            items = items.filter(i => i.contacts.includes(contact.toLowerCase()));
        if (topic)
            items = items.filter(i => i.topicId === topic);
        if (thread)
            items = items.filter(i => i.evidence.some(e => e.source.threadId === thread));
        const people = [...new Set(items.flatMap(i => i.contacts))].sort();
        const topics = [...new Map(items.map(i => [i.topicId, { id: i.topicId, name: i.topic, accountId: i.accountId }])).values()];
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const ranked = items.map(i => ({ ...i, reason: i.status === 'snoozed' ? `Snoozed until ${new Date(i.snoozedUntil!).toLocaleString()}` : i.certainty === 'suggested' ? 'Suggested from the conversation' : i.due && i.due < today ? 'Past due' : i.due === today ? 'Due today' : i.status === 'waiting' ? `Waiting${i.owner ? ' for ' + i.owner : ''}` : i.kind === 'decision' ? 'Decision carried forward' : 'Open commitment' }));
        const decisions = ranked.filter(i => i.kind === 'decision' && i.status !== 'dismissed');
        const tasks = ranked.filter(i => i.kind === 'task' && (filter === 'done' ? i.status === 'done' : filter === 'snoozed' ? i.status === 'snoozed' : filter === 'dismissed' ? i.status === 'dismissed' : !['done', 'dismissed', 'snoozed'].includes(i.status)))
            .filter(i => filter === 'waiting' ? i.status === 'waiting' : filter === 'mine' ? Boolean(i.owner && i.owner === (i.accountEmail ?? query.get('self'))) : true)
            .sort((a, b) => Number(a.certainty === 'suggested') - Number(b.certainty === 'suggested') || (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.updatedAt.localeCompare(a.updatedAt));
        return { items: tasks, decisions, people, topics, scan: this.state() };
    }
}
