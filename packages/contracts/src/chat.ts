import { z } from "zod";
import { cragSummarySchema, demoScenarioSchema } from "./crag";
import { audienceSchema, citationSchema, demoEventSchema, traceEventSchema } from "./domain";
import { LIMITS } from "./limits";
import { researchScenarioSchema, researchSourceSchema, researchSummarySchema } from "./research";

export const chatModeSchema = z.enum(["sin-rag", "rag", "crag", "research"]);

export type ChatMode = z.infer<typeof chatModeSchema>;

const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(LIMITS.maxAssistantMessageChars),
});

const demoPartSchema = z.object({
  type: z.literal("data-demo"),
  data: demoEventSchema.extend({
    label: z.string().max(LIMITS.maxMessageChars),
  }),
});

const sourcePartSchema = z.object({
  type: z.literal("data-source"),
  data: citationSchema,
});

const tracePartSchema = z.object({
  type: z.literal("data-trace"),
  data: traceEventSchema,
});

const cragPartSchema = z.object({
  type: z.literal("data-crag"),
  data: cragSummarySchema,
});

const researchPartSchema = z.object({
  type: z.literal("data-research"),
  data: researchSummarySchema,
});

const researchSourcePartSchema = z.object({
  type: z.literal("data-research-source"),
  data: researchSourceSchema,
});

const messagePartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  demoPartSchema,
  sourcePartSchema,
  tracePartSchema,
  cragPartSchema,
  researchPartSchema,
  researchSourcePartSchema,
]);

export const chatMessageSchema = z
  .object({
    id: z.string().min(1).max(LIMITS.maxIdChars),
    role: z.enum(["user", "assistant"]),
    parts: z.array(messagePartSchema).min(1).max(LIMITS.maxPartsPerMessage),
  })
  .superRefine((message, context) => {
    if (message.role === "user" && message.parts.some((part) => part.type !== "text")) {
      context.addIssue({
        code: "custom",
        path: ["parts"],
        message: "Los mensajes del usuario solo admiten texto.",
      });
    }
    if (message.role === "user") {
      for (const part of message.parts) {
        if (part.type === "text" && part.text.length > LIMITS.maxUserMessageChars) {
          context.addIssue({
            code: "custom",
            path: ["parts"],
            message: `El mensaje del usuario supera ${String(LIMITS.maxUserMessageChars)} caracteres.`,
          });
        }
      }
    }
  });

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export function messageText(message: ChatMessage): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

export const chatRequestSchema = z
  .object({
    mode: chatModeSchema,
    audience: audienceSchema.default("program"),
    demoScenario: demoScenarioSchema.optional(),
    researchScenario: researchScenarioSchema.optional(),
    messages: z.array(chatMessageSchema).min(1).max(LIMITS.maxHistoryMessages),
  })
  .superRefine((value, context) => {
    if (value.researchScenario !== undefined && value.mode !== "research") {
      context.addIssue({
        code: "custom",
        path: ["researchScenario"],
        message: "El guion de investigación solo vale en la etapa de investigación.",
      });
    }
    const total = value.messages.reduce((sum, message) => sum + messageText(message).length, 0);
    if (total > LIMITS.maxHistoryChars) {
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: `El historial supera ${String(LIMITS.maxHistoryChars)} caracteres.`,
      });
    }

    const last = value.messages.at(-1);
    if (last === undefined || last.role !== "user" || messageText(last).trim().length === 0) {
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: "El último mensaje debe ser del usuario y no puede estar vacío.",
      });
    }
  });

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface FieldIssue {
  path: string;
  message: string;
}

export function issuesFrom(error: z.ZodError): FieldIssue[] {
  return error.issues.slice(0, LIMITS.maxIssues).map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join("."),
    message: issue.message,
  }));
}
