'use client'

import { useIssues } from '$/stores/issues'
import {
  SafeIssuesParams,
  convertIssuesParamsToQueryParams,
} from '@latitude-data/constants/issues'
import { useCurrentCommit } from '$/app/providers/CommitProvider'
import { useCurrentProject } from '$/app/providers/ProjectProvider'
import { IssuesServerResponse } from '../../page'
import { useIssuesParameters } from '$/stores/issues/useIssuesParameters'
import { useOnce } from '$/hooks/useMount'
import { useMemo } from 'react'
import { Button } from '@latitude-data/web-ui/atoms/Button'
import { TableWithHeader } from '@latitude-data/web-ui/molecules/ListingHeader'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@latitude-data/web-ui/atoms/Table'
import { TableBlankSlate } from '@latitude-data/web-ui/molecules/TableBlankSlate'

export function IssuesDashboard({
  serverCount,
  serverResponse,
  params,
}: {
  serverCount: number
  serverResponse: IssuesServerResponse
  params: SafeIssuesParams
}) {
  const { init } = useIssuesParameters((state) => ({
    init: state.init,
  }))
  const { project } = useCurrentProject()
  const { commit } = useCurrentCommit()

  // Always use server params to ensure stable cache keys
  const serverUrlParameters = useMemo(
    () => convertIssuesParamsToQueryParams({ params }),
    [params],
  )

  const issuesData = useMemo(() => {
    return {
      data: {
        projectId: project.id,
        commitUuid: commit.uuid,
        // Always use server params to match the cache key used by fallbackData
        searchParams: serverUrlParameters,
      },
    }
  }, [project.id, commit.uuid, serverUrlParameters])

  const {
    data: issues,
    isLoading,
    isLoadingMore,
    hasPrevPage,
    moveBackward,
    hasNextPage,
    moveForward,
  } = useIssues(issuesData, {
    fallbackData: serverResponse,
  })

  // Initialize the store for future updates
  // useOnce(() => {
  //   init({
  //     params,
  //   })
  // })

  // console.log('IDs: ', issues.map((i) => i.id))

  const noData = !isLoading && !issues.length
  const loading = isLoading || isLoadingMore
  return (
    <div className='flex flex-grow min-h-0 flex-col w-full p-6 gap-2 min-w-0'>
      <TableWithHeader
        title='Issues'
        table={
          <>
            {noData ? (
              <TableBlankSlate description='No issues in this project' />
            ) : (
              <Table
                externalFooter={
                  <div className='flex items-center justify-center gap-x-2'>
                    <Button
                      variant='ghost'
                      disabled={!hasPrevPage || loading}
                      onClick={moveBackward}
                    >
                      Previous Page
                    </Button>
                    <Button
                      variant='ghost'
                      disabled={!hasNextPage || loading}
                      onClick={moveForward}
                    >
                      Next Page
                    </Button>
                  </div>
                }
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map((issue) => (
                    <TableRow
                      key={issue.id}
                      className='border-b-[0.5px] h-12 max-h-12 border-border'
                    >
                      <TableCell>{issue.id}</TableCell>
                      <TableCell>{issue.title}</TableCell>
                      <TableCell>
                        {JSON.stringify(
                          {
                            recentCount: issue.recentCount,
                            isNew: issue.isNew,
                            isResolved: issue.isResolved,
                            isEscalating: issue.isEscalating,
                          },
                          null,
                          2,
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        }
      />
    </div>
  )
}
