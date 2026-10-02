import { sourceSchema, type Source } from './model.js';
import { fingerprint, WorkStore } from './store.js';
export async function getJson(base: string, path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<any> {
    const response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers }, signal: AbortSignal.any([AbortSignal.timeout(path.includes('extract') ? 180000 : 60000), ...(signal ? [signal] : [])]) });
    const body = await response.json() as any;
    if (!response.ok)
        throw Object.assign(new Error(body.detail ?? body.error ?? `Service returned ${response.status}`),{status:response.status});
    return body;
}
export class WorkScanner {
    #flight: Promise<void> | undefined;
    #controller: AbortController | undefined;
    #queue: Promise<void> = Promise.resolve();
    #controllers = new Set<AbortController>();
    get active() { return this.#analyses.size > 0 || Boolean(this.#flight); }
    #analyses = new Map<string, Promise<void>>();
    #timer: ReturnType<typeof setInterval> | undefined;
    constructor(readonly store: WorkStore, readonly mailBase: string, readonly agentBase: string) { store.setState({ running: false }); }
    start(run = true) { if (!this.#controller || this.#controller.signal.aborted) this.#controller = new AbortController(); clearInterval(this.#timer); this.#timer = setInterval(() => { if (this.store.state().enabled)
        void this.scan().catch(() => undefined); }, 300000); this.#timer.unref(); if (run && this.store.state().enabled)
        void this.scan().catch(() => undefined); }
    async pause() { this.stop(); await Promise.allSettled([...(this.#flight ? [this.#flight] : []), ...this.#analyses.values()]); }
    stop() { clearInterval(this.#timer); this.#controller?.abort(); for (const controller of this.#controllers)
        controller.abort(); }
    scan(more = false): Promise<void> {
        if (this.#flight)
            return this.#flight;
        const depth = Math.min(1000,this.store.state().depth + (more ? 30 : 0));
        this.store.setState({ enabled: true, running: true, scanned: 0, total: 0, failures: 0, error: null, depth });
        this.#controller = new AbortController();
        this.#flight = this.#run(depth, this.#controller.signal).catch(e => { this.store.setState({ error: String(e instanceof Error ? e.message : e) }); throw e; }).finally(() => { this.store.setState({ running: false, lastScan: new Date().toISOString() }); this.#flight = undefined; });
        return this.#flight;
    }
    async #run(depth: number, signal: AbortSignal) {
        const { candidates } = await getJson(this.mailBase, `/v1/work/candidates?limit=${depth}`, {}, signal);
        this.store.setState({ total: candidates.length });
        for (const candidate of candidates) {
            if (signal.aborted)
                break;
            let unavailable=false;
            try {
                await this.analyze(candidate.accountId, candidate.threadId, signal);
            }
            catch (e) {
                this.store.setState({ failures: this.store.state().failures + 1, error: String(e instanceof Error ? e.message : e) });
                unavailable=[401,403,429,502,503].includes((e as {status?:number}).status??0);
                if (signal.aborted)
                    break;
            }
            this.store.setState({ scanned: this.store.state().scanned + 1 });
            if(unavailable)break;
        }
    }
    analyze(accountId: string, threadId: string, signal?: AbortSignal): Promise<void> {
        const key = JSON.stringify([accountId, threadId]), pending = this.#analyses.get(key);
        if (pending)
            return pending;
        this.#controller ??= new AbortController();
        const controller = new AbortController();
        this.#controllers.add(controller);
        const combined = AbortSignal.any([controller.signal, signal ?? this.#controller.signal]);
        const task = this.#queue.catch(() => undefined).then(() => this.#analyze(accountId, threadId, combined)).finally(() => { this.#analyses.delete(key); this.#controllers.delete(controller); });
        this.#queue = task;
        this.#analyses.set(key, task);
        return task;
    }
    async #analyze(accountId: string, threadId: string, signal?: AbortSignal) {
        const params = new URLSearchParams({ account: accountId, thread: threadId });
        const mail = await getJson(this.mailBase, `/v1/work/sources?${params}`, {}, signal);
        const addresses = new Set<string>(mail.sources.flatMap((s: any) => s.participants).filter((e: string) => e !== mail.accountEmail));
        const related = this.store.all(accountId).filter(i => i.contacts.some(c => addresses.has(c)));
        params.set('contacts', JSON.stringify([...addresses].slice(0, 30)));
        params.set('topics', JSON.stringify([...new Set(related.map(i => i.topicId))].slice(0, 30)));
        const chat = await getJson(this.agentBase, `/v1/work/sources?${params}`, {}, signal);
        const sources: Source[] = [...mail.sources, ...chat.sources].map(s => sourceSchema.parse(s));
        if (!sources.length)
            return;
        const scanKey = JSON.stringify([accountId, threadId]);
        if (this.store.seen(scanKey, fingerprint(sources)))
            return;
        const existing = related.map(({ evidence, ...item }) => item);
        const result = await getJson(this.agentBase, '/v1/work/extract', { method: 'POST', body: JSON.stringify({ sources, existing }) }, signal);
        this.store.reconcile(accountId, scanKey, sources, result);
    }
}
