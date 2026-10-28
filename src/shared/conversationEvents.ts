import { z } from 'zod'
import type { NativeCommunicationRequest, CommunicationQuestion } from './communication'

const text = z.string().max(100000)
export const conversationSchema = z
  .object({
    id: z.string().uuid(),
    owner: z.string().min(1).max(512),
    target: z.string().max(512).optional(),
    spaceId: z.string().uuid().optional(),
    anchor: z.string().max(600).optional(),
    cards: z
      .array(
        z
          .object({
            id: z.string().max(600),
            anchor: z.string().max(600).optional(),
            order: z.number().int().nonnegative().optional(),
            revision: z.number().int().positive(),
            at: z.number().finite(),
            updatedAt: z.number().finite(),
            source: z.string().max(512),
            title: z.string().max(300),
            kind: z.enum(['native', 'question', 'result', 'status']),
            state: z.string().max(80),
            body: text,
            messageId: z.string().uuid().optional(),
            requestId: z.string().uuid().optional(),
            generation: z.string().max(200).optional(),
            request: z
              .object({
                id: z.string().uuid(),
                generation: z.string().max(200),
                revision: z.number().int().positive().optional(),
                canAllow: z.boolean().optional(),
                nativeKind: z
                  .enum(['approval', 'questions', 'permissions', 'elicitation'])
                  .optional(),
                target: z.string().max(512),
                kind: z.enum(['question', 'approval', 'next-step']),
                title: z.string().max(4000),
                detail: text.optional(),
                startedAt: z.number().finite(),
                expiresAt: z.number().finite(),
                questions: z
                  .array(
                    z.object({
                      id: z.string().max(200).optional(),
                      other: z.boolean().optional(),
                      question: z.string().max(4000),
                      options: z.array(z.object({ label: z.string().max(4000) })).optional(),
                    }),
                  )
                  .max(20)
                  .optional(),
              })
              .optional(),
            question: z
              .object({
                answerDelivery: z.enum(['message', 'tool']).optional(),
                allowOther: z.boolean().optional(),
                expiresAt: z.number().finite().positive().optional(),
                id: z.string().uuid(),
                spaceId: z.string().uuid(),
                taskId: z.string().uuid().optional(),
                originMessageId: z.string().uuid().optional(),
                sender: z.string().max(512),
                senderTarget: z.string().max(512).optional(),
                audience: z.string().max(512),
                body: text,
                choices: z.array(z.string().max(4000)).max(20),
                generation: z.string().max(200),
                reason: text.optional(),
                state: z.enum(['pending', 'answered', 'expired']),
                at: z.number().finite(),
                answer: text.optional(),
                answeredBy: z.string().max(512).optional(),
                messageId: z.string().uuid().optional(),
              })
              .optional(),
            speech: z.enum([
              'pending',
              'reserved',
              'submitted',
              'announced',
              'uncertain',
              'suppressed',
            ]),
            announcementId: z.string().uuid().optional(),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict()
export type ConversationRecord = z.infer<typeof conversationSchema>
export type ConversationCard = Omit<ConversationRecord['cards'][number], 'request' | 'question'> & {
  request?: NativeCommunicationRequest
  question?: CommunicationQuestion
}
export interface ConversationFeed {
  owner: string
  cards: ConversationCard[]
  cursor: number
}
export interface Announcement {
  id: string
  owner: string
  cards: { id: string; revision: number }[]
  text: string
}
export type AnnouncementCommand =
  | { action: 'next' }
  | { action: 'speak'; id: string }
  | { action: 'settle'; id: string; outcome: 'announced' | 'uncertain' | 'suppressed' | 'deferred' }
export type AnnouncementReply =
  { ok: true; announcement?: Announcement } | { ok: false; reason: string }
