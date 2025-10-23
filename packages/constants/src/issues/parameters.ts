import { z } from 'zod'
import { parseISO, isValid } from 'date-fns'
import {
  ISSUE_STATUSES,
  ISSUE_SORTS,
  SafeIssuesParams,
  QUERY_DIRECTION,
  DEFAULTS_ISSUE_PARAMS,
  IssueSort,
  IssueStatus,
} from './constants'

const MAX_ISSUES_LIMIT = 100
const LIMIT = DEFAULTS_ISSUE_PARAMS.limit

const ISSUES_STATUSES_VALUES = Object.values(ISSUE_STATUSES) as [
  IssueStatus,
  ...IssueStatus[],
]
const ISSUE_SORTS_VALUES = Object.values(ISSUE_SORTS) as [
  IssueSort,
  ...IssueSort[],
]

export const issuesFiltersQueryParamsParser = z
  .object({
    documentUuid: z.string().optional(),
    query: z.string().optional(),
    statuses: z
      .string()
      .transform((v) => v.split(','))
      .pipe(z.array(z.enum(ISSUES_STATUSES_VALUES)))
      .optional(),
    sort: z
      .enum(ISSUE_SORTS_VALUES)
      .optional()
      .default(DEFAULTS_ISSUE_PARAMS.sorting.sort),
    sortDirection: z
      .enum(['asc', 'desc'])
      .optional()
      .default(DEFAULTS_ISSUE_PARAMS.sorting.sortDirection),
    direction: z
      .enum(QUERY_DIRECTION)
      .optional()
      .default(DEFAULTS_ISSUE_PARAMS.sorting.direction),
    firstSeenFrom: z.string().optional(),
    firstSeenTo: z.string().optional(),
    lastSeenFrom: z.string().optional(),
    lastSeenTo: z.string().optional(),
    cursor: z.string().optional(),
    limit: z
      .string()
      .optional()
      .transform((val) => {
        const limit = Number(val)
        if (Number.isNaN(limit) || limit < 1) return LIMIT

        return Math.min(limit, MAX_ISSUES_LIMIT)
      }),
  })
  .transform(
    ({
      firstSeenFrom,
      firstSeenTo,
      lastSeenFrom,
      lastSeenTo,
      ...rest
    }): SafeIssuesParams => {
      const common = {
        limit: rest.limit,
        direction: rest.direction,
        cursor: rest.cursor,
        sorting: {
          sort: rest.sort,
          sortDirection: rest.sortDirection,
          direction: rest.direction,
        },
        filters: {
          query: rest.query,
          documentUuid: rest.documentUuid,
          statuses: rest.statuses,
        },
      }

      if (firstSeenFrom && firstSeenTo) {
        const from = parseISO(firstSeenFrom)
        const to = parseISO(firstSeenTo)
        if (isValid(from) && isValid(to)) {
          return {
            ...common,
            filters: {
              ...common.filters,
              firstSeen: { from, to },
            },
          }
        }
      }

      if (lastSeenFrom && lastSeenTo) {
        const from = parseISO(lastSeenFrom)
        const to = parseISO(lastSeenTo)
        if (isValid(from) && isValid(to)) {
          return {
            ...common,
            filters: {
              ...common.filters,
              lastSeen: { from, to },
            },
          }
        }
      }

      return common
    },
  )

export type IssuesFiltersQueryParamsOutput = z.output<
  typeof issuesFiltersQueryParamsParser
>

// Soft input type where all fields are strings or undefined
// Like query params in URL
export type IssuesFiltersQueryParamsInput = Record<
  keyof z.input<typeof issuesFiltersQueryParamsParser>,
  string | undefined
>
