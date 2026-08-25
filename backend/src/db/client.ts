import pg, { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { config } from '../config.js'

/*
 * PostgreSQL по умолчанию отдаёт BIGINT строками: драйвер не рискует терять
 * точность, ведь 64-битное число не влезает в обычное число JavaScript.
 * Из-за этого id игрока приходил как "5", а не 5, и любое сравнение с числом
 * молча давало ложь.
 *
 * Разбираем BIGINT числом, но со страховкой: если значение выйдет за предел
 * безопасной точности (около 9·10^15), запрос упадёт с понятной ошибкой,
 * а не отдаст тихо испорченное число.
 */
const INT8_OID = 20
pg.types.setTypeParser(INT8_OID, (value: string) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`значение BIGINT ${value} не помещается в число JavaScript без потери точности`)
  }
  return parsed
})

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (err) => {
  console.error('Ошибка простаивающего соединения с БД', err)
})

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(text, params as never[])
  return result.rows
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}

/**
 * Выполняет функцию внутри транзакции БД.
 *
 * Любое изменение баланса обязано проходить здесь: строка в transactions
 * и обновление users.coins_balance должны фиксироваться вместе или не
 * фиксироваться вовсе.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function closePool(): Promise<void> {
  await pool.end()
}
