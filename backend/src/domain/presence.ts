/**
 * Кто сейчас у экрана.
 *
 * Ответ знает слой WebSocket — там живут открытые соединения. Но нужен он
 * в обычной игровой логике: показывать ли открытый бой в списке, можно ли
 * позвать друга прямо сейчас. Чтобы игровая часть не зависела от сокетов,
 * проверка подставляется снаружи одной функцией.
 */

export type LivenessCheck = (userId: number) => boolean

let check: LivenessCheck = () => true

export function setLivenessCheck(next: LivenessCheck): void {
  check = next
}

export function isOnline(userId: number): boolean {
  return check(userId)
}
