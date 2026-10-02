import { workApi, type WorkItem, type WorkView, type WorkSource, type WorkContext } from './work-api.js';
import './work.css';
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const date = (value: string | null) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No due date';
interface Hooks {
    account: () => {
        id?: string;
        email?: string;
    };
    context: (value: WorkContext) => void;
    source: (value: WorkSource) => Promise<void>;
    draft: (item: WorkItem) => Promise<void>;
    showDetail: () => void;
    scopesChanged: () => void;
}
/** Presentation only. Work service owns ranking, filters, evidence and mutations. */
export class WorkPage {
    mode: 'ea' | 'todos' = 'ea';
    active = false;
    context: WorkContext | undefined;
    #data: WorkView | undefined;
    #selected: WorkItem | undefined;
    #filter = 'all';
    #contact = '';
    #topic = '';
    #account = '';
    #error = '';
    #sequence = 0;
    #busy = false;
    #poll: number | undefined;
    #undo: {
        item: WorkItem;
        before: WorkItem;
    } | undefined;
    get scopes(): {email?:WorkSource; contact?:WorkContext; topic?:WorkContext} {
        const item=this.#selected;
        if(!item)return {};
        const email=[...item.evidence].reverse().find(e=>e.source.kind==='email')?.source;
        const contact=item.contacts.find(c=>c!==(item.accountEmail ?? this.hooks.account().email)) ?? item.contacts[0];
        return {email,contact:contact?{kind:'contact',accountId:item.accountId,contextId:contact}:undefined,topic:{kind:'topic',accountId:item.accountId,contextId:item.topicId}};
    }
    constructor(readonly list: HTMLElement, readonly detail: HTMLElement, readonly hooks: Hooks) {
        list.addEventListener('click', event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-work]'); if (button)
            void this.#click(button).catch(e => this.#fail(e)); });
        detail.addEventListener('click', event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-work]'); if (button)
            void this.#click(button).catch(e => this.#fail(e)); });
        list.addEventListener('change', event => { const select = event.target as HTMLSelectElement; if (select.dataset.workSelect === 'person') {
            this.#contact = select.value;
            this.#topic = '';
            void this.refresh();
        } if (select.dataset.workSelect === 'topic') {
            this.#topic = select.value;
            this.#contact = '';
            this.#account = this.#data?.topics.find(t => t.id === select.value)?.accountId ?? '';
            void this.refresh();
        } });
        detail.addEventListener('submit', event => { event.preventDefault(); const form = event.target as HTMLFormElement; if (form.dataset.workEdit !== undefined)
            void this.#edit(form).catch(e => this.#fail(e)); });
    }
    async open(mode: 'ea' | 'todos', contact?: string, account?: string) { this.active = true; this.context = undefined; this.mode = mode; this.#contact = contact ?? ''; this.#account = account ?? ''; this.#topic = ''; this.#filter = 'all'; this.#selected = undefined; this.#data = undefined; this.#undo = undefined; this.#error = ''; this.render(); await this.refresh(); clearInterval(this.#poll); this.#poll = window.setInterval(() => { if (this.active && !this.#busy)
        void this.refresh(false); }, 5000); }
    close() { this.active = false; this.context = undefined; this.#sequence++; clearInterval(this.#poll); }
    async refresh(select = true) { const sequence = ++this.#sequence; const a = this.hooks.account(); const params = new URLSearchParams({ filter: this.#filter, ...(this.#account || a.id ? { account: this.#account || a.id! } : {}), ...(a.email ? { self: a.email } : {}), ...(this.#contact ? { contact: this.#contact } : {}), ...(this.#topic ? { topic: this.#topic } : {}) }); try {
        const data = await workApi.list(params);
        if (sequence !== this.#sequence || !this.active)
            return;
        if (!select && JSON.stringify(this.#data) === JSON.stringify(data))
            return;
        if (!select && !this.#busy && this.detail.querySelector('form')?.contains(document.activeElement))
            return;
        this.#data = data;
        this.#error = '';
        this.#selected = [...data.items, ...data.decisions].find(i => i.id === this.#selected?.id) ?? (select ? data.items[0] ?? data.decisions[0] : undefined);
        this.render();
        // A polling refresh updates records, but must not change a chosen chat scope.
        if (select || !this.context) this.#setContext();
    }
    catch (e) {
        if (sequence === this.#sequence && this.active)
            this.#fail(e);
    } }
    #setContext() { const item = this.#selected; const accountId = this.#account || item?.accountId || this.hooks.account().id; if (!accountId)
        return; const next: WorkContext | undefined = this.#contact ? { kind: 'contact', accountId, contextId: this.#contact } : this.#topic || item ? { kind: 'topic', accountId, contextId: this.#topic || item!.topicId } : undefined; if (next && JSON.stringify(next) !== JSON.stringify(this.context)) {
        this.context = next;
        this.hooks.context(next);
    } }
    #fail(error: unknown) { this.#error = error instanceof Error ? error.message : String(error); this.render(); }
    render() {
        const data = this.#data, item = this.#selected, scan = data?.scan;
        this.list.innerHTML = `<header class="work-list-header"><span class="work-eyebrow">${this.mode === 'ea' ? 'Executive assistant' : 'To-dos'}</span><h2>${this.mode === 'ea' ? 'What needs you today' : 'Work that stays with you'}</h2><p>${this.mode === 'ea' ? 'Your commitments, replies and decisions.' : 'One place for work across email threads.'}</p><button class="btn btn-sm btn-ghost-primary" data-work="scan" ${scan?.running ? 'disabled' : ''}><i class="ti ti-refresh" aria-hidden="true"></i>${scan?.running ? 'Reviewing mail…' : scan?.enabled ? 'Review new mail' : 'Find open work'}</button></header>
      <div class="work-filters" role="group" aria-label="To-do filters">${[['all', 'All'], ['mine', 'Mine'], ['waiting', 'Waiting'], ['done', 'Done'], ['snoozed', 'Snoozed']].map(([v, label]) => `<button class="btn btn-sm ${v === this.#filter ? 'btn-primary' : 'btn-ghost-secondary'}" data-work="filter" data-value="${v}" aria-pressed="${v === this.#filter}">${label}</button>`).join('')}</div>
      <div class="work-rows">${!data ? '<p class="work-empty">Connecting to your work…</p>' : !data.items.length ? `<p class="work-empty">${scan?.running ? 'Reviewing your conversations. Results appear here as they are found.' : scan?.enabled ? 'No to-dos in this view.' : 'Find commitments and unanswered questions in your recent mail and Codex discussions.'}</p>` : data.items.map((row, index) => `${row.certainty === 'suggested' && data.items[index - 1]?.certainty !== 'suggested' ? '<h3 class="work-section-label">Suggestions · review first</h3>' : ''}<button class="work-row ${item?.id === row.id ? 'active' : ''}" data-work="select" data-id="${row.id}" aria-pressed="${item?.id === row.id}"><span class="work-row-icon"><i class="ti ti-${row.status === 'done' ? 'circle-check' : row.status === 'waiting' ? 'clock-hour-4' : 'circle'}" aria-hidden="true"></i></span><span><strong>${escape(row.title)}</strong><small>${escape(row.topic)} · ${escape(row.owner ?? 'Owner not set')}</small><span class="work-row-reason">${escape(row.reason)}${row.due ? ' · ' + date(row.due) : ''}</span></span><i class="ti ti-chevron-right" aria-hidden="true"></i></button>`).join('')}</div>
      <footer class="work-list-footer"><details><summary>People & topics</summary><label>Contact<select class="form-select form-select-sm" data-work-select="person" aria-label="Work by contact"><option value="">All contacts</option>${(data?.people ?? []).map(p => `<option ${p === this.#contact ? 'selected' : ''} value="${escape(p)}">${escape(p)}</option>`).join('')}</select></label><label>Topic<select class="form-select form-select-sm" data-work-select="topic" aria-label="Work by topic"><option value="">All topics</option>${(data?.topics ?? []).map(t => `<option ${t.id === this.#topic ? 'selected' : ''} value="${t.id}">${escape(t.name)}</option>`).join('')}</select></label></details>
      <p role="status">${scan?.running ? `Reviewed ${scan.scanned} of ${scan.total} conversations` : scan?.lastScan ? `Last reviewed ${date(scan.lastScan)} · Up to ${scan.depth} recent threads per account` : 'Email remains available while work is reviewed.'}${scan?.failures ? ` · ${scan.failures} could not be reviewed` : ''}</p>${scan?.enabled ? '<button class="btn btn-sm btn-ghost-secondary" data-work="pause">Pause automatic review</button>' : ''}${scan?.enabled && !scan.running ? '<button class="btn btn-sm btn-ghost-secondary" data-work="more">Include 30 older threads</button>' : ''}</footer>`;
        this.detail.innerHTML = `<div class="work-detail-inner">${this.#error ? `<div class="work-notice" role="alert">${escape(this.#error)} <button class="btn btn-sm" data-work="retry">Retry</button></div>` : ''}${scan?.error ? `<details class="work-notice"><summary>Some work could not be reviewed</summary><p>${escape(scan.error)}</p><button class="btn btn-sm" data-work="scan">Try again</button></details>` : ''}${this.#undo ? '<div class="work-undo" role="status">To-do updated. <button class="btn btn-sm btn-ghost-primary" data-work="undo">Undo</button></div>' : ''}
      ${this.#contact || this.#topic ? `<header class="work-context-header"><span class="work-eyebrow">${this.#contact ? 'Contact' : 'Topic'} · across threads</span><h2>${escape(this.#contact || data?.topics.find(t => t.id === this.#topic)?.name)}</h2><button class="btn btn-sm btn-ghost-secondary" data-work="clear">All work</button></header>` : ''}
      ${item ? this.#item(item) : '<div class="work-welcome"><i class="ti ti-sparkles" aria-hidden="true"></i><h2>A clear view of what comes next.</h2><p>Select a to-do to see its history, sources and next step.</p></div>'}
      ${data?.decisions.length ? `<section class="work-decisions"><h3>Decisions carried forward</h3>${data.decisions.map(d => `<button data-work="select" data-id="${d.id}" class="work-decision"><i class="ti ti-bookmark" aria-hidden="true"></i><span><strong>${escape(d.title)}</strong><small>${escape(d.summary)}</small></span></button>`).join('')}</section>` : ''}</div>`;
        this.hooks.scopesChanged();
    }
    #item(item: WorkItem) {
        return `<article aria-label="Selected to-do"><div class="work-detail-kicker"><span class="work-status">${escape(item.certainty === 'suggested' ? 'Suggestion' : item.kind === 'decision' ? 'Decision' : item.status)}</span><span>${escape(item.reason)}</span></div><h1>${escape(item.title)}</h1><p class="work-summary">${escape(item.summary)}</p><div class="work-properties"><span><small>Owner</small>${escape(item.owner ?? 'Not set')}</span><span><small>Due</small>${date(item.due)}</span><span><small>Topic</small><button data-work="topic" data-value="${item.topicId}" class="work-link">${escape(item.topic)}</button></span></div>
    <div class="work-actions">${item.kind === 'task' ? `<button class="btn btn-primary btn-sm" data-work="draft"><i class="ti ti-pencil" aria-hidden="true"></i>Draft follow-up</button><button class="btn btn-sm" data-work="status" data-value="${item.status === 'done' ? 'open' : 'done'}"><i class="ti ti-check" aria-hidden="true"></i>${item.status === 'done' ? 'Reopen' : 'Done'}</button><button class="btn btn-sm" data-work="snooze"><i class="ti ti-clock" aria-hidden="true"></i>Snooze</button>` : ''}${item.certainty === 'suggested' ? '<button class="btn btn-sm" data-work="keep">Keep as to-do</button>' : ''}<button class="btn btn-sm btn-ghost-secondary" data-work="status" data-value="dismissed">Dismiss</button></div>
    <div class="work-contacts">${item.contacts.map(c => `<button class="btn btn-sm btn-ghost-secondary" data-work="contact" data-value="${escape(c)}"><i class="ti ti-user" aria-hidden="true"></i>${escape(c)}</button>`).join('')}</div>
    <details class="work-edit"><summary>Edit details</summary><form data-work-edit><label>To-do<input name="title" class="form-control" value="${escape(item.title)}" required maxlength="180"></label><label>Owner email<input name="owner" type="email" class="form-control" value="${escape(item.owner)}"></label><label>Due date<input name="due" type="date" class="form-control" value="${escape(item.due)}"></label><button class="btn btn-sm" type="submit">Save changes</button></form></details>
    <section class="work-evidence"><h3>Source trail <span>${item.evidence.length}</span></h3>${item.evidence.map((e, index) => `<div class="work-source"><div><i class="ti ti-${e.source.kind === 'email' ? 'mail' : 'sparkles'}" aria-hidden="true"></i><button class="work-link" data-work="source" data-index="${index}">${escape(e.source.title)}</button><time>${e.source.at ? date(e.source.at) : 'Codex discussion'}</time></div><blockquote>${escape(e.quote)}</blockquote><small>${escape(e.source.author)}</small></div>`).join('')}</section></article>`;
    }
    async #change(patch: Record<string, unknown>) { const before = this.#selected; if (!before || this.#busy)
        return; this.#busy = true; try {
        const { item } = await workApi.action(before, patch);
        this.#undo = { item, before };
        this.#selected = item;
        await this.refresh(false);
    }
    finally {
        this.#busy = false;
    } }
    async #edit(form: HTMLFormElement) { const data = new FormData(form); await this.#change({ title: data.get('title'), owner: data.get('owner') || null, due: data.get('due') || null }); }
    async #click(button: HTMLElement) {
        const action = button.dataset.work, value = button.dataset.value, item = this.#selected;
        if (action === 'select') {
            this.#selected = [...(this.#data?.items ?? []), ...(this.#data?.decisions ?? [])].find(i => i.id === button.dataset.id);
            this.render();
            this.#setContext();
            this.hooks.showDetail();
        }
        else if (action === 'filter') {
            this.#filter = value!;
            this.#selected = undefined;
            await this.refresh();
        }
        else if (action === 'scan' || action === 'more') {
            await workApi.scan(action === 'more');
            await this.refresh(false);
        }
        else if (action === 'pause') {
            await workApi.pause();
            await this.refresh(false);
        }
        else if (action === 'retry')
            await this.refresh();
        else if (action === 'clear') {
            this.#contact = '';
            this.#topic = '';
            this.#account = '';
            await this.refresh();
        }
        else if (action === 'contact' && item) {
            this.#contact = value!;
            this.#topic = '';
            this.#account = item.accountId;
            await this.refresh();
        }
        else if (action === 'topic' && item) {
            this.#topic = value!;
            this.#contact = '';
            this.#account = item.accountId;
            await this.refresh();
        }
        else if (action === 'source' && item) {
            const source = item.evidence[Number(button.dataset.index)]?.source;
            if (source)
                await this.hooks.source(source);
        }
        else if (action === 'draft' && item)
            await this.hooks.draft(item);
        else if (action === 'status')
            await this.#change({ status: value });
        else if (action === 'keep')
            await this.#change({ certainty: 'explicit' });
        else if (action === 'snooze') {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            await this.#change({ status: 'snoozed', snoozedUntil: tomorrow.toISOString() });
        }
        else if (action === 'undo' && this.#undo) {
            const { item, before } = this.#undo;
            await workApi.undo(item);
            this.#undo = undefined;
            await this.refresh();
        }
    }
}
