import type { Tool } from 'ai'
import {
  ChainStepObjectResponse,
  LogSources,
  ToolDefinition,
  ToolExecutionOptions,
} from '@latitude-data/constants'
import { StreamManager } from '../../lib/streamManager'
import { getToolSimulationPrompt } from './getCopilotData'
import { runDocumentAtCommit } from '../commits'
import { BACKGROUND } from '../../telemetry'

export function simulatedToolDefinition({
  streamManager,
  toolName,
  toolDefinition,
}: {
  streamManager: StreamManager
  toolName: string
  toolDefinition: ToolDefinition
}): Tool['execute'] {
  return async (
    args: Record<string, unknown>,
    toolCall: ToolExecutionOptions,
  ) => {
    try {
      const simulationPrompt = await getToolSimulationPrompt().then((r) =>
        r.unwrap(),
      )

      const { response } = await runDocumentAtCommit({
        context: BACKGROUND({ workspaceId: simulationPrompt.workspace.id }),
        commit: simulationPrompt.commit,
        document: simulationPrompt.document,
        workspace: simulationPrompt.workspace,
        source: LogSources.Copilot,
        parameters: {
          toolName,
          toolDescription: toolDefinition.description,
          toolInputSchema: toolDefinition.parameters,
          toolArgs: args,
          messages: toolCall.messages,
          prompt: streamManager.simulationSettings?.simulationDescription,
        },
      }).then((r) => r.unwrap())

      const res = await response

      if (!res) {
        return {
          isError: true,
          value: 'No response from simulation',
        }
      }

      const { isError, value } = (
        res as ChainStepObjectResponse<{
          isError: boolean
          value: object | string
        }>
      ).object

      return {
        isError,
        value,
      }
    } catch (_) {
      return {
        isError: true,
        value: 'Unexpected simulation error',
      }
    }
  }
}
