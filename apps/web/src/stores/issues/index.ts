import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR, { SWRConfiguration } from 'swr'
import { ROUTES } from '$/services/routes'
import { IssuesServerResponse } from '$/app/(private)/projects/[projectId]/versions/[commitUuid]/issues/page'
import {
  IssuesFiltersQueryParamsInput,
  QUERY_DIRECTION,
  QueryDirection,
} from '@latitude-data/constants/issues'
import useFetcher from '$/hooks/useFetcher'

const EMPTY_ISSUES_RESPONSE = {
  issues: [],
  prevCursor: null,
  nextCursor: null,
} satisfies IssuesServerResponse

export function useIssues(
  {
    data: { projectId, commitUuid, searchParams },
  }: {
    data: {
      projectId: number
      commitUuid: string
      searchParams: Partial<IssuesFiltersQueryParamsInput>
    }
  },
  swrConfig?: SWRConfiguration<IssuesServerResponse, any>,
) {
  const isSSR = useRef(!!swrConfig?.fallbackData)
  const route = ROUTES.api.projects.detail(projectId).commits.detail(commitUuid)
    .issues.root

  const [currentCursor, setCurrentCursor] = useState<string | null>(null)
  const [direction, setDirection] = useState<QueryDirection>(
    QUERY_DIRECTION.forward,
  )
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([])
  const stableDeps = useMemo(
    () => [
      'issues',
      String(projectId),
      commitUuid,
      `query:${searchParams.query || '-'}`,
      `statuses:${searchParams.statuses ?? '-'}`,
      `sort:${searchParams.sort || '-'}`,
      `sortDirection:${searchParams.sortDirection || '-'}`,
      `documentUuid:${searchParams.documentUuid || '-'}`,
      `limit:${searchParams.limit || '-'}`,
      `firstSeenFrom:${searchParams.firstSeenFrom || '-'}`,
      `firstSeenTo:${searchParams.firstSeenTo || '-'}`,
      `lastSeenFrom:${searchParams.lastSeenFrom || '-'}`,
      `lastSeenTo:${searchParams.lastSeenTo || '-'}`,
      ...(currentCursor ? [`cursor:${currentCursor}`] : []),
    ],
    [
      projectId,
      commitUuid,
      searchParams.query,
      searchParams.statuses,
      searchParams.sort,
      searchParams.sortDirection,
      searchParams.documentUuid,
      searchParams.limit,
      searchParams.firstSeenFrom,
      searchParams.firstSeenTo,
      searchParams.lastSeenFrom,
      searchParams.lastSeenTo,
      currentCursor,
    ],
  )

  // --- Fetcher (includes direction for backend)
  const fetcher = useFetcher<IssuesServerResponse>(route, {
    searchParams: {
      ...searchParams,
      ...(currentCursor ? { cursor: currentCursor } : {}),
      direction,
    },
  })
  const isFirstPage = currentCursor === null

  const {
    data = EMPTY_ISSUES_RESPONSE,
    isLoading,
    isValidating,
  } = useSWR<IssuesServerResponse>(stableDeps, isSSR.current ? null : fetcher, {
    fallbackData: isSSR.current ? swrConfig?.fallbackData : undefined,
    keepPreviousData: true,

    revalidateOnMount: !isFirstPage, // Don't revalidate on mount for the first page
    revalidateIfStale: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  })

  // --- Prefetch next page (optional optimization)
  const hasNextPage = Boolean(data?.nextCursor)
  const hasPrevPage = Boolean(cursorStack.length > 0)

  const moveForward = useCallback(() => {
    if (!data?.nextCursor) return

    setDirection(QUERY_DIRECTION.forward)
    setCursorStack((prev) => [...prev, currentCursor])

    queueMicrotask(() => setCurrentCursor(data.nextCursor))
  }, [data?.nextCursor, currentCursor])

  const moveBackward = useCallback(() => {
    if (cursorStack.length === 0) return

    setDirection(QUERY_DIRECTION.backward)
    const prevCursor = cursorStack[cursorStack.length - 1] ?? null
    setCursorStack((prev) => prev.slice(0, -1))

    queueMicrotask(() => setCurrentCursor(prevCursor))
  }, [cursorStack])

  useEffect(() => {
    isSSR.current = false
  }, [])

  return useMemo(
    () => ({
      data: data.issues ?? [],
      isLoading,
      isLoadingMore: isValidating,
      hasNextPage,
      hasPrevPage,
      moveForward,
      moveBackward,
    }),
    [
      data,
      isLoading,
      isValidating,
      hasNextPage,
      hasPrevPage,
      moveForward,
      moveBackward,
    ],
  )
}
