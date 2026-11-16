// Ошибка приложения: преобразуется в ответ { error: { code, message } }
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
