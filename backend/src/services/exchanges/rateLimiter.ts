/**
 * Birja API so'rovlarini xavfsiz chastotada yuborish uchun oddiy navbat (queue).
 *
 * Nima uchun kerak: birjalar (Binance va h.k.) IP yoki API kalit darajasida
 * "rate limit" (so'rov chastotasi chegarasi) qo'yadi - chegaradan oshilsa,
 * vaqtinchalik yoki butunlay bloklanish (ban) mumkin. Har bir kalit/maqsad
 * uchun so'rovlarni ketma-ket va minimal interval bilan yuborish orqali bu
 * xavfni oldini olamiz.
 */

const MIN_INTERVAL_MS = 350;

const queues = new Map<string, Promise<unknown>>();

export function withRateLimit<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const scheduled = previous
    .catch(() => undefined)
    .then(() => new Promise<void>((resolve) => setTimeout(resolve, MIN_INTERVAL_MS)))
    .then(fn);
  const queued = scheduled.catch(() => undefined);
  queues.set(key, queued);
  // Remove from map once settled so the Map doesn't grow unboundedly
  queued.finally(() => {
    if (queues.get(key) === queued) queues.delete(key);
  });
  return scheduled;
}
