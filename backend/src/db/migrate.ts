import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, closePool } from './client.js'

/**
 * Простой прогонщик миграций.
 *
 * Читает .sql-файлы из migrations/ по алфавиту, применяет непринятые каждую
 * в своей транзакции и записывает имя в schema_migrations. Повторный запуск
 * безопасен: уже применённые пропускаются.
 *
 * Намеренно без библиотеки — весь механизм умещается на экран и его можно
 * прочитать целиком, что важнее экономии тридцати строк.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

async function ensureRegistry(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function appliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations')
  return new Set(rows.map((r) => r.name))
}

export async function migrate(): Promise<{ applied: string[]; skipped: number }> {
  await ensureRegistry()
  const done = await appliedMigrations()

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  const applied: string[] = []

  for (const file of files) {
    if (done.has(file)) continue

    const sql = await readFile(join(migrationsDir, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      applied.push(file)
      console.log(`  применена ${file}`)
    } catch (error) {
      await client.query('ROLLBACK')
      console.error(`  ОШИБКА в ${file}`)
      throw error
    } finally {
      client.release()
    }
  }

  return { applied, skipped: files.length - applied.length }
}

// Запуск напрямую: npm run migrate
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirectRun) {
  migrate()
    .then(({ applied, skipped }) => {
      if (applied.length === 0) console.log(`Миграции: всё уже применено (${skipped})`)
      else console.log(`Миграции: применено ${applied.length}, пропущено ${skipped}`)
      return closePool()
    })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
