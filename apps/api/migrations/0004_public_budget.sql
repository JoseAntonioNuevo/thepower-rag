-- Migración 0004 del D1 del curso: contador del presupuesto público del chat.
-- Qué hace: guarda cuántos USD se han reservado en la URL publicada y cuántos turnos hubo.
-- Por qué: antes de cada turno, `apps/api/src/public-budget.ts` suma el peor coste posible con
-- un único UPDATE condicional. Si la suma supera el tope, la fila no cambia y no se llama al
-- modelo. Así dos peticiones simultáneas no pueden pasarse del tope a la vez.
-- Importante: lo reservado es el peor caso, no el gasto real facturado.
CREATE TABLE IF NOT EXISTS public_budget (
  -- Id del presupuesto (una sola fila, `course-2026`).
  id TEXT PRIMARY KEY,
  -- USD reservados acumulados.
  reserved_usd REAL NOT NULL DEFAULT 0,
  -- Turnos de chat que han reservado.
  turns INTEGER NOT NULL DEFAULT 0
);
-- Crea la fila inicial solo si no existe: volver a aplicar no pone el contador a cero.
INSERT OR IGNORE INTO public_budget(id) VALUES ('course-2026');
