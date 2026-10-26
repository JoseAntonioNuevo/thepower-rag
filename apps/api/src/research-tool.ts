// GUÍA DE LECTURA · apps/api/src/research-tool.ts
// Herramienta get_order de la investigación: devuelve en solo lectura los datos de un pedido de la
// cuenta de la conversación (producto, vendedor, pago, fechas y estado). Los pedidos son ficticios y
// viven en corpus/thepower-shop/pedidos.json. La cuenta la fija el servidor: un número leído en una
// imagen, un audio o una página nunca da acceso al pedido de otra cuenta.
// Validación de argumentos y tipos de la herramienta.
import {
  validateOrderArgs,
  type OrderToolPort,
  type PortResult,
  type ToolEvidence,
} from "@thepower-rag/research";
// Pedidos ficticios incluidos en el bundle.
import orderData from "../../../corpus/thepower-shop/pedidos.json";

// Un pedido de los datos ficticios.
export interface OrderRecord {
  // Número del pedido (TPS-12345).
  orderId: string;
  // Cuenta a la que pertenece.
  customerId: string;
  // Producto, categoría y vendedor.
  product: string;
  category: string;
  seller: string;
  // Precio y método de pago, tal como se muestran al cliente.
  price: string;
  payment: string;
  // Fechas de compra y de entrega (null si aún no se ha entregado).
  orderedAt: string;
  deliveredAt: string | null;
  // Estado y devoluciones o reclamaciones abiertas.
  status: string;
  openCases: string;
}

// Archivo de pedidos: versión, cuenta de la conversación y pedidos.
export interface OrderFile {
  // Versión de los datos, que viaja con cada resultado.
  version: string;
  // Cuenta de la conversación en esta demo.
  customerId: string;
  // Pedidos de todas las cuentas.
  orders: OrderRecord[];
}

/** Datos de pedidos empaquetados: una cuenta de demo y un pedido de otra cuenta. */
export const ORDER_DATA = orderData as OrderFile;

// Resultado correcto sin consumo (es una lectura local).
const ok = <T>(value: T): PortResult<T> => ({ ok: true, value, consumption: { kind: "none" } });

/** Texto que devuelve la herramienta: líneas literales que el informe puede citar. */
export function orderLines(order: OrderRecord): string[] {
  // Una línea por grupo de datos.
  return [
    `Pedido ${order.orderId}: ${order.product} (${order.category}).`,
    `Vendedor: ${order.seller}. Precio: ${order.price}. Pago: ${order.payment}.`,
    order.deliveredAt === null
      ? `Fecha de compra: ${order.orderedAt}. Entrega: todavía no se ha entregado.`
      : `Fecha de compra: ${order.orderedAt}. Entrega: ${order.deliveredAt}.`,
    `Estado: ${order.status}. Devoluciones o reclamaciones abiertas: ${order.openCases}.`,
  ];
}

/**
 * get_order({ orderId }) en modo solo lectura.
 * - Valida la forma del número.
 * - Devuelve null si el pedido no existe.
 * - Rechaza un pedido de otra cuenta sin enseñar ningún dato suyo.
 */
export function createOrderTool(input: {
  // Datos de pedidos.
  data: OrderFile;
  // Cuenta de la conversación; la decide el servidor, nunca el modelo.
  customerId: string;
}): OrderToolPort {
  // Puerto de la herramienta.
  return {
    // Lee un pedido de la cuenta de la conversación.
    getOrder(raw, context) {
      // Valida los argumentos del modelo.
      const args = validateOrderArgs(raw);
      // Inválidos.
      if (!args.ok) {
        // Error.
        return Promise.resolve({
          ok: false,
          error: "invalid",
          detail: args.reason,
          consumption: { kind: "none" },
        });
      }
      // Cancelado.
      if (context.signal.aborted) {
        // Error.
        return Promise.resolve({
          ok: false,
          error: "aborted",
          detail: "Petición detenida.",
          consumption: { kind: "none" },
        });
      }
      // Pedido con ese número.
      const order = input.data.orders.find((item) => item.orderId === args.value.orderId);
      // No existe.
      if (order === undefined) {
        // Sin resultado.
        return Promise.resolve(ok(null));
      }
      // De otra cuenta: rechazo sin datos.
      if (order.customerId !== input.customerId) {
        // Bloqueado.
        return Promise.resolve({
          ok: false,
          error: "blocked",
          detail: `El pedido ${order.orderId} no pertenece a la cuenta de esta conversación.`,
          consumption: { kind: "none" },
        });
      }
      // Evidencia de la herramienta.
      const evidence: ToolEvidence = {
        kind: "tool",
        sourceId: `tool:order:${order.orderId.toLowerCase()}`,
        toolName: "get_order",
        title: `get_order · ${order.orderId}`,
        text: orderLines(order).join("\n").slice(0, 1_200),
        dataVersion: input.data.version,
      };
      // Resultado.
      return Promise.resolve(ok(evidence));
    },
  };
}
