// Error de negocio con código estable (para pruebas y pantallas) y mensaje en español claro.
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Registro') => new AppError(404, 'NOT_FOUND', `${what} no encontrado.`);
export const forbidden = (msg = 'No tienes permiso para esta acción.') => new AppError(403, 'FORBIDDEN', msg);
export const badRequest = (msg: string, details?: Record<string, unknown>) => new AppError(400, 'BAD_REQUEST', msg, details);
