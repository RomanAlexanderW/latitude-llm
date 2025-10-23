import { deflateSync, inflateSync } from 'zlib'
import { sql, SQL } from 'drizzle-orm'
import { IssueSort, SafeIssuesParams } from '@latitude-data/constants/issues'
import { Issue } from '../../schema/models/types/Issue'
import { issues } from '../../schema/models/issues'
import { HISTOGRAM_SUBQUERY_ALIAS } from '@latitude-data/constants/issues'

type IssueWithStats = Omit<Issue, 'description'> & {
  recentCount: number
  lastSeenDate: Date
}

type SortDirection = SafeIssuesParams['sorting']['sortDirection']

type CursorPayload = {
  sort: IssueSort
  sortDirection: SortDirection
  values: {
    id: number
    recentCount?: number
    lastSeenDate?: Date
    createdAt?: Date
  }
}

/**
 * Builds cursor-based pagination conditions and cursors for issues
 * based on the selected sort and sort direction.
 */
export class IssuesCursorBuilder {
  private sort: IssueSort
  private sortDirection: SortDirection
  private decoded: CursorPayload | null

  constructor({
    sort,
    sortDirection,
    cursor,
  }: {
    sort: IssueSort
    sortDirection: SortDirection
    cursor?: string | null
  }) {
    this.sort = sort
    this.sortDirection = sortDirection
    this.decoded = this.parse(cursor)
  }

  get whereCondition(): SQL | undefined {
    if (!this.decoded) return undefined

    const cursor = this.decoded
    const subquery = HISTOGRAM_SUBQUERY_ALIAS
    const comparator = this.sortDirection === 'desc' ? '<' : '>'
    const { values } = cursor

    switch (this.sort) {
      case 'relevance': {
        // Use COALESCE for lastSeenDate to handle NULL from LEFT JOIN
        // Use epoch date as sentinel for NULL values
        const minDate = sql.raw(`'1970-01-01 00:00:00'::timestamp`)
        const cursorDate = values.lastSeenDate
          ? sql`${values.lastSeenDate}::timestamp`
          : sql.raw(`'1970-01-01 00:00:00'::timestamp`)
        const cursorRecentCount = values.recentCount ?? 0
        const condition = sql`(
          COALESCE(${sql.raw(`"${subquery}"."recentCount"`)}, 0),
          COALESCE(${sql.raw(`"${subquery}"."lastSeenDate"`)}, ${minDate}),
          ${issues.id}
        ) ${sql.raw(comparator)} (
          ${cursorRecentCount},
          ${cursorDate},
          ${values.id}
        )`

        return condition
      }

      case 'lastSeen': {
        // Use COALESCE for lastSeenDate to handle NULL from LEFT JOIN
        const minDateLs = sql.raw(`'1970-01-01 00:00:00'::timestamp`)
        const cursorDate = values.lastSeenDate
          ? sql`${values.lastSeenDate}::timestamp`
          : sql.raw(`'1970-01-01 00:00:00'::timestamp`)
        return sql`(
          COALESCE(${sql.raw(`"${subquery}"."lastSeenDate"`)}, ${minDateLs}),
          ${issues.id}
        ) ${sql.raw(comparator)} (
          ${cursorDate},
          ${values.id}
        )`
      }

      case 'firstSeen': {
        const cursorCreatedAt = values.createdAt
          ? sql`${values.createdAt}::timestamp`
          : null
        return sql`(
          ${issues.createdAt},
          ${issues.id}
        ) ${sql.raw(comparator)} (
          ${cursorCreatedAt},
          ${values.id}
        )`
      }

      default:
        return sql`${issues.id} ${sql.raw(comparator)} ${values.id}`
    }
  }

  buildCursors({
    results,
    limit,
  }: {
    results: IssueWithStats[]
    limit: number
  }) {
    const nextCursor = this.buildNextCursor({ results, limit })
    const prevCursor = this.buildPrevCursor({ results })

    return { prevCursor, nextCursor }
  }

  private buildPrevCursor({
    results,
  }: {
    results: IssueWithStats[]
  }): string | null {
    // If we have a decoded cursor, we're not on the first page, so generate prevCursor
    if (!this.decoded) return null

    const firstRow = results[0]
    if (!firstRow) return null

    return this.encode(this.extractPayload(firstRow))
  }

  /**
   * Build next cursor if there are more results
   * it encodes the necessary values from the last row
   */
  private buildNextCursor({
    results,
    limit,
  }: {
    results: IssueWithStats[]
    limit: number
  }) {
    // We fetch limit+1 to check if there are more results
    // If we got more than 'limit' results, there's a next page
    const hasMore = results.length > limit
    if (!hasMore) return null

    // Use the last row within our returned limit (the one we actually return to user)
    const lastRow = results[limit - 1]
    if (!lastRow) return null

    const payload: CursorPayload = this.extractPayload(lastRow)
    return this.encode(payload)
  }

  private extractPayload(row: IssueWithStats): CursorPayload {
    switch (this.sort) {
      case 'relevance':
        return {
          sort: this.sort,
          sortDirection: this.sortDirection,
          values: {
            id: row.id,
            recentCount: Number(row.recentCount),
            lastSeenDate: row.lastSeenDate,
          },
        }
      case 'lastSeen':
        return {
          sort: this.sort,
          sortDirection: this.sortDirection,
          values: {
            id: row.id,
            lastSeenDate: row.lastSeenDate,
          },
        }
      case 'firstSeen':
        return {
          sort: this.sort,
          sortDirection: this.sortDirection,
          values: {
            id: row.id,
            createdAt: row.createdAt,
          },
        }
      default:
        return {
          sort: this.sort,
          sortDirection: this.sortDirection,
          values: { id: row.id },
        }
    }
  }

  private parse(cursor?: string | null): CursorPayload | null {
    const decoded = this.decode(cursor)
    if (!decoded) return null

    return this.validate(decoded)
  }

  /**
   * Compress and Base64URL-encode a JSON object.
   * Short url-friendly representation of the cursor.
   */
  private encode<T extends object>(data: T | null) {
    if (!data) return null

    try {
      const json = JSON.stringify(data)
      const compressed = deflateSync(Buffer.from(json))
      return compressed.toString('base64url')
    } catch {
      return null
    }
  }

  /**
   * Decode and decompress a previously encoded cursor.
   */
  private decode(encoded?: string | null): CursorPayload | null {
    if (!encoded) return null
    try {
      const compressed = Buffer.from(encoded, 'base64url')
      const json = inflateSync(compressed).toString('utf-8')
      const parsed = JSON.parse(json) as CursorPayload

      // Ensure recentCount is always a number after JSON parsing
      if (parsed.values.recentCount !== undefined) {
        parsed.values.recentCount = Number(parsed.values.recentCount)
      }

      return parsed
    } catch {
      return null
    }
  }

  /**
   * If the cursor's sort or sortDirection do not match the current ones,
   * invalidate it. Does not check the values.
   */
  private validate(cursor: CursorPayload): CursorPayload | null {
    if (
      cursor.sort !== this.sort ||
      cursor.sortDirection !== this.sortDirection
    ) {
      return null
    }
    return cursor
  }
}
