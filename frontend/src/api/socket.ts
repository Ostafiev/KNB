import { API_BASE_URL } from '../config/env'

/**
 * Канал реального времени.
 *
 * Матч не работает на обычных запросах: соперник ходит тогда, когда ходит,
 * и опрашивать сервер каждую секунду было бы и медленно, и расточительно.
 *
 * Связь рвётся — это норма для телефона в дороге. Поэтому клиент сам
 * переподключается с растущей паузой и заново представляется серверу.
 */

export type SocketEvent = { type: string; [key: string]: unknown }
type Listener = (event: SocketEvent) => void

function socketUrl(token: string): string {
  const base = API_BASE_URL.startsWith('http')
    ? API_BASE_URL.replace(/^http/, 'ws').replace(/\/api\/?$/, '')
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
  return `${base}/ws?token=${encodeURIComponent(token)}`
}

const RECONNECT_STEPS_MS = [500, 1000, 2000, 4000, 8000, 15_000]

class MatchSocket {
  private socket: WebSocket | null = null
  private token: string | null = null
  private listeners = new Set<Listener>()
  private outbox: string[] = []
  private attempt = 0
  private closedByUs = false
  private pingTimer: ReturnType<typeof setInterval> | null = null

  /** Открыто ли соединение прямо сейчас. */
  connected = false

  connect(token: string): void {
    if (this.token === token && this.socket) return
    this.token = token
    this.closedByUs = false
    this.open()
  }

  private open(): void {
    if (!this.token) return

    let socket: WebSocket
    try {
      socket = new WebSocket(socketUrl(this.token))
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.connected = true
      this.attempt = 0
      for (const message of this.outbox.splice(0)) socket.send(message)
      this.emit({ type: 'socket_open' })

      // Лёгкий пинг: держит соединение живым через прокси, которые
      // закрывают молчащие каналы через минуту.
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25_000)
    }

    socket.onmessage = (message) => {
      try {
        this.emit(JSON.parse(message.data as string) as SocketEvent)
      } catch {
        /* мусор в канале игнорируем */
      }
    }

    socket.onclose = () => {
      this.connected = false
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.pingTimer = null
      this.socket = null
      this.emit({ type: 'socket_closed' })
      if (!this.closedByUs) this.scheduleReconnect()
    }

    socket.onerror = () => {
      /* про разрыв узнаем из onclose */
    }
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_STEPS_MS[Math.min(this.attempt, RECONNECT_STEPS_MS.length - 1)]
    this.attempt += 1
    setTimeout(() => {
      if (!this.closedByUs) this.open()
    }, delay)
  }

  private emit(event: SocketEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  send(message: unknown): void {
    const payload = JSON.stringify(message)
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(payload)
    } else {
      // Отправим, как только соединение откроется: игрок не должен терять ход
      // из-за того, что связь моргнула ровно в момент нажатия.
      this.outbox.push(payload)
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  disconnect(): void {
    this.closedByUs = true
    this.socket?.close()
    this.socket = null
    this.connected = false
  }
}

export const matchSocket = new MatchSocket()
