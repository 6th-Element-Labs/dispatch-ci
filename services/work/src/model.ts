import { z } from 'zod';
export const email = z.string().email().max(254).transform(v => v.trim().toLowerCase());
const id = z.string().min(1).max(300);
export const sourceSchema = z.object({
    accountEmail: email.optional(), id, kind: z.enum(['email', 'codex']), accountId: id, threadId: id, messageId: z.string(),
    codexThreadId: z.string().optional(), turnId: z.string().optional(), title: z.string().max(1000),
    at: z.string(), author: z.string().max(500), participants: z.array(email).max(100), text: z.string().max(24000),
}).strict();
export type Source = z.infer<typeof sourceSchema>;
export const candidateSchema = z.object({
    existingId: z.string().nullable(), kind: z.enum(['task', 'decision']), title: z.string().min(1).max(180),
    summary: z.string().max(1500), topic: z.string().min(1).max(100), owner: email.nullable(),
    status: z.enum(['open', 'waiting', 'done']), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    certainty: z.enum(['explicit', 'suggested']), contacts: z.array(email).max(30),
    evidence: z.array(z.object({ sourceId: id, quote: z.string().min(1).max(1000) }).strict()).min(1).max(12),
}).strict();
export const extractionSchema = z.object({ items: z.array(candidateSchema).max(60) }).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export type Status = 'open' | 'waiting' | 'done' | 'snoozed' | 'dismissed';
export interface Evidence {
    source: Source;
    quote: string;
}
export interface WorkItem {
    id: string;
    accountId: string;
    accountEmail?: string;
    kind: 'task' | 'decision';
    title: string;
    summary: string;
    topic: string;
    topicId: string;
    contacts: string[];
    owner: string | null;
    due: string | null;
    status: Status;
    certainty: 'explicit' | 'suggested';
    snoozedUntil: string | null;
    userEdited: boolean;
    revision: number;
    updatedAt: string;
    evidence: Evidence[];
    reason?: string;
}
export const actionSchema = z.object({ revision: z.number().int().positive(),
    status: z.enum(['open', 'waiting', 'done', 'snoozed', 'dismissed']).optional(),
    snoozedUntil: z.string().datetime().nullable().optional(), title: z.string().trim().min(1).max(180).optional(),
    owner: email.nullable().optional(), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    certainty: z.enum(['explicit', 'suggested']).optional(),
}).strict();
export type Action = z.infer<typeof actionSchema>;
export interface ScanState {
    enabled: boolean;
    running: boolean;
    scanned: number;
    total: number;
    depth: number;
    lastScan: string | null;
    error: string | null;
    failures: number;
}
