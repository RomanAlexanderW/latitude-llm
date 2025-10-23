import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  isNull,
  lte,
  or,
  sql,
  SQL,
} from 'drizzle-orm'
import { type Issue } from '../schema/models/types/Issue'
import { type Project } from '../schema/models/types/Project'
import { type Commit } from '../schema/models/types/Commit'
import { issues } from '../schema/models/issues'
import { Result } from '../lib/Result'
import Repository from './repositoryV2'
import { IssueHistogramsRepository } from './issueHistogramsRepository'
import { CommitsRepository } from './commitsRepository'
import {
  SafeIssuesParams,
  IssueSort,
  ESCALATING_COUNT_THRESHOLD,
  HISTOGRAM_SUBQUERY_ALIAS,
} from '@latitude-data/constants/issues'
import { IssuesCursorBuilder } from '../data-access/issues/CursorBuilder'

const tt = getTableColumns(issues)

type IssueFilters = SafeIssuesParams['filters']
type Sorting = SafeIssuesParams['sorting']
type FilteringArguments = {
  project: Project
  commit: Commit
  filters: IssueFilters
  sorting: Sorting
  cursor?: string
}

export class IssuesRepository extends Repository<Issue> {
  get scopeFilter() {
    return eq(issues.workspaceId, this.workspaceId)
  }

  get scope() {
    return this.db.select(tt).from(issues).where(this.scopeFilter).$dynamic()
  }

  /**
   * Get total count of filtered issues (respects cursor filtering if provided).
   * The idea is to do this request only once on the server side to get total count for pagination.
   */
  async fetchIssuesCount({
    project,
    commit,
    cursor,
    filters,
    sorting: { sort, sortDirection: originalSortDirection, direction },
  }: FilteringArguments) {
    const sortDirection = this.getDirection({
      direction,
      sortDirection: originalSortDirection,
    })
    const cursorHelper = new IssuesCursorBuilder({
      sort,
      sortDirection,
      cursor,
    })
    const whereConditions = this.buildWhereConditions({
      project,
      filters,
      cursor: cursorHelper,
    })
    const havingConditions = this.buildHavingConditions({ filters })
    const commitIds = await this.getCommitIds({ commit })
    const subquery = this.buildHistogramSubquery({ commitIds })

    const query = this.db
      .select({ count: sql<number>`COUNT(*)::integer` })
      .from(issues)
      .leftJoin(subquery, eq(subquery.issueId, issues.id))
      .where(and(...whereConditions))
      .having(
        havingConditions.length > 0 ? and(...havingConditions) : undefined,
      )

    const result = await query
    return Result.ok(result[0]?.count ?? 0)
  }

  /**
   * Cursor based pagination for issues with filtering and sorting.
   */
  async fetchIssuesFiltered({
    project,
    commit,
    cursor,
    filters,
    sorting: { sort, sortDirection: originalSortDirection, direction },
    limit,
  }: FilteringArguments & { limit: number }) {
    // 1. Prepare query components
    const actualFetchLimit = limit + 1
    const sortDirection = this.getDirection({
      direction,
      sortDirection: originalSortDirection,
    })
    const cursorHelper = new IssuesCursorBuilder({
      sort,
      sortDirection,
      cursor,
    })
    const whereConditions = this.buildWhereConditions({
      project,
      filters,
      cursor: cursorHelper,
    })

    // If fetching backwards, flip the sort direction
    const havingConditions = this.buildHavingConditions({ filters })
    const orderByClause = this.buildOrderByClause({
      sort,
      sortDirection,
    })

    // 2. Execute the query
    const results = await this.fetchIssues({
      commit,
      where: whereConditions,
      having: havingConditions,
      orderBy: orderByClause,
      limit: actualFetchLimit, // 1 is next cursor check
    })

    /* console.log('Returned results:', results.length) */

    // 3. Process results for pagination
    return Result.ok({
      issues: results.slice(0, limit),
      ...cursorHelper.buildCursors({ results, limit }),
    })
  }

  private async fetchIssuesCountQuery({
    commit,
    where,
    having,
  }: {
    commit: Commit
    where: SQL[]
    having: SQL[]
  }) {}

  private async fetchIssues({
    commit,
    where,
    having,
    orderBy,
    limit,
  }: {
    commit: Commit
    where: SQL[]
    having: SQL[]
    orderBy: SQL[]
    limit: number
  }) {
    const commitIds = await this.getCommitIds({ commit })
    const subquery = this.buildHistogramSubquery({ commitIds })
    // Make listing lighter by excluding description field
    const { description: _, ...issueColumns } = tt
    const query = this.db
      .select({
        ...issueColumns,
        recentCount: sql<number>`COALESCE(${subquery.recentCount}::integer, 0)`,
        lastSeenDate: sql<Date>`COALESCE(${subquery.lastSeenDate}, '1970-01-01 00:00:00'::timestamp)`,
        escalatingCount: sql<number>`COALESCE(${subquery.escalatingCount}::integer, 0)`,
        isNew:
          sql<boolean>`(${issues.createdAt} >= NOW() - INTERVAL '7 days')`.as(
            'isNew',
          ),
        isResolved: sql<boolean>`(${issues.resolvedAt} IS NOT NULL)`.as(
          'isResolved',
        ),
        isEscalating: sql<boolean>`(
          CASE
            WHEN COALESCE(${subquery.escalatingCount}::integer, 0) > ${ESCALATING_COUNT_THRESHOLD}
            THEN true
            ELSE false
          END
        )`.as('isEscalating'),
        isIgnored: sql<boolean>`(${issues.ignoredAt} IS NOT NULL)`.as(
          'isIgnored',
        ),
      })
      .from(issues)
      .leftJoin(subquery, eq(subquery.issueId, issues.id))
      .where(and(...where))
      .having(having.length > 0 ? and(...having) : undefined)
      .orderBy(...orderBy)
      .limit(limit)

    return await query
  }

  private buildHistogramSubquery({ commitIds }: { commitIds: number[] }) {
    const histogramRepo = new IssueHistogramsRepository(
      this.workspaceId,
      this.db,
    )
    return histogramRepo.getHistogramStatsSubquery({
      commitIds,
    })
  }

  private buildWhereConditions({
    project,
    filters,
    cursor,
  }: {
    project: Project
    filters: IssueFilters
    cursor: IssuesCursorBuilder
  }) {
    const conditions: SQL[] = [
      this.scopeFilter,
      eq(issues.projectId, project.id),
    ]

    if (filters.documentUuid) {
      conditions.push(eq(issues.documentUuid, filters.documentUuid))
    }

    if (filters.query && filters.query.trim().length > 0) {
      conditions.push(sql`${issues.title} % ${filters.query}`)
    }

    // Handle resolved/ignored status filtering in WHERE clause
    if (filters.statuses && filters.statuses.length > 0) {
      const hasResolved = filters.statuses.includes('resolved')
      const hasIgnored = filters.statuses.includes('ignored')

      if (hasResolved && !hasIgnored) {
        // User wants resolved issues (and possibly others), exclude ignored
        conditions.push(isNull(issues.ignoredAt))
      } else if (hasIgnored && !hasResolved) {
        // User wants ignored issues (and possibly others), exclude resolved
        conditions.push(isNull(issues.resolvedAt))
      }
    } else {
      // By default, filter out ignored and resolved issues unless status filter is specified
      conditions.push(isNull(issues.resolvedAt))
      conditions.push(isNull(issues.ignoredAt))
    }

    const cursorCondition = cursor.whereCondition

    if (cursorCondition) {
      conditions.push(cursorCondition)
    }

    return conditions
  }

  private buildHavingConditions({ filters }: { filters: IssueFilters }) {
    const conditions: SQL[] = []

    if (filters.statuses && filters.statuses.length > 0) {
      const statuses = filters.statuses.map((status) => {
        switch (status) {
          case 'new':
            return sql`"isNew" = true`
          case 'escalating':
            return sql`"escalatingCount" > 0`
          case 'resolved':
            return sql`"isResolved" = true`
          case 'ignored':
            return sql`"isIgnored" = true`
          default:
            return sql`1 = 0` // Never matches
        }
      })

      const condition = or(...statuses)
      if (condition) conditions.push(condition)
    }

    if (filters.firstSeen) {
      const condition = and(
        gte(issues.createdAt, filters.firstSeen.from),
        lte(issues.createdAt, filters.firstSeen.to),
      )
      if (condition) conditions.push(condition)
    }

    if (filters.lastSeen) {
      const condition = and(
        gte(
          sql.raw(`"${HISTOGRAM_SUBQUERY_ALIAS}"."lastSeenDate"`),
          filters.lastSeen.from,
        ),
        lte(
          sql.raw(`"${HISTOGRAM_SUBQUERY_ALIAS}"."lastSeenDate"`),
          filters.lastSeen.to,
        ),
      )
      if (condition) conditions.push(condition)
    }

    return conditions
  }

  private buildOrderByClause({
    sort,
    sortDirection,
  }: {
    sort: IssueSort
    sortDirection: Sorting['sortDirection']
  }) {
    const dir = sortDirection === 'asc' ? asc : desc

    switch (sort) {
      case 'lastSeen':
        // Handle NULL lastSeenDate by using a sentinel date
        return [
          dir(
            sql.raw(
              `COALESCE("${HISTOGRAM_SUBQUERY_ALIAS}"."lastSeenDate", '1970-01-01 00:00:00'::timestamp)`,
            ),
          ),
          dir(issues.id),
        ]

      case 'firstSeen':
        return [dir(issues.createdAt), dir(issues.id)]

      default: // includes 'relevance'
        // Handle NULL lastSeenDate and recentCount by using sentinel values
        return [
          dir(
            sql.raw(`COALESCE("${HISTOGRAM_SUBQUERY_ALIAS}"."recentCount", 0)`),
          ),
          dir(
            sql.raw(
              `COALESCE("${HISTOGRAM_SUBQUERY_ALIAS}"."lastSeenDate", '1970-01-01 00:00:00'::timestamp)`,
            ),
          ),
          dir(issues.id),
        ]
    }
  }

  /**
   * Determine the effective sort direction based on the query direction.
   * This is here for when user click previous/next buttons to
   * fetch data in different directions.
   */
  private getDirection({
    direction,
    sortDirection,
  }: {
    direction: Sorting['direction']
    sortDirection: Sorting['sortDirection']
  }) {
    if (direction === 'backward') {
      return sortDirection === 'asc' ? 'desc' : 'asc'
    }
    return sortDirection
  }

  private async getCommitIds({ commit }: { commit: Commit }) {
    const commitsRepo = new CommitsRepository(this.workspaceId, this.db)
    const commits = await commitsRepo.getCommitsHistory({ commit })
    return commits.map((c: { id: number }) => c.id)
  }
}
