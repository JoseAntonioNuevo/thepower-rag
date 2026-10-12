// GUÍA DE LECTURA · packages/contracts/src/errors.ts
// Forma de las respuestas de error de la API: petición inválida, configuración incompleta
// o fallo del proveedor. El navegador las valida con el mismo esquema.
import { z } from "zod";

// Error de la API; el campo error indica cuál de las tres formas es.
export const errorResponseSchema = z.discriminatedUnion("error", [
  // Petición mal formada (HTTP 400) con la lista de campos inválidos.
  z.object({
    error: z.literal("invalid_request"),
    message: z.string(),
    issues: z.array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    ),
  }),
  // Falta configuración (HTTP 409) con los nombres de las variables o bindings ausentes.
  z.object({
    error: z.literal("configuration"),
    message: z.string(),
    missing: z.array(z.string()),
  }),
  // El proveedor del modelo falló; el mensaje es genérico y no expone detalles.
  z.object({
    error: z.literal("provider"),
    message: z.string(),
  }),
]);

// Tipo de una respuesta de error.
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
