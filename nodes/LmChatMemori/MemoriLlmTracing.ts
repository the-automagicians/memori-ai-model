import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';
import {
	NodeConnectionTypes,
	NodeError,
	NodeOperationError,
	type IDataObject,
	type ISupplyDataFunctions,
	type JsonObject,
} from 'n8n-workflow';

const SECRET_KEYS = new Set(['apikey', 'openaiapikey', 'authorization']);

function redact(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redact);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([k, v]) => [
				k,
				SECRET_KEYS.has(k.toLowerCase()) ? '***' : redact(v),
			]),
		);
	}
	return value;
}

/**
 * Minimal re-implementation of n8n's N8nLlmTracing (@n8n/ai-utilities), which
 * community nodes can't import (CLAUDE.md rule #6). Writes each LLM call to the
 * sub-node's input/output so it shows up in the execution Logs panel.
 */
export class MemoriLlmTracing extends BaseCallbackHandler {
	name = 'MemoriLlmTracing';

	// Make LangChain await us so handleLLMError runs before the error propagates.
	awaitHandlers = true;

	private runs: Record<string, { index: number; prompts: string[] }> = {};

	constructor(private readonly ctx: ISupplyDataFunctions) {
		super();
	}

	async handleLLMStart(llm: Serialized, prompts: string[], runId: string): Promise<void> {
		const options = redact(llm.type === 'constructor' ? llm.kwargs : llm);
		const { index } = this.ctx.addInputData(NodeConnectionTypes.AiLanguageModel, [
			[{ json: { messages: prompts, options } as IDataObject }],
		]);
		this.runs[runId] = { index, prompts };
	}

	async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
		const run = this.runs[runId] ?? { index: Object.keys(this.runs).length, prompts: [] };
		const generations = output.generations.map((gen) =>
			gen.map(({ text, generationInfo }) => ({ text, generationInfo })),
		);
		const tokenUsage = output.llmOutput?.tokenUsage as IDataObject | undefined;
		const response = { response: { generations }, ...(tokenUsage ? { tokenUsage } : {}) };

		this.ctx.addOutputData(NodeConnectionTypes.AiLanguageModel, run.index, [
			[{ json: response as unknown as IDataObject }],
		]);
		this.logEvent('ai-llm-generated-output', { messages: run.prompts, response });
		delete this.runs[runId];
	}

	async handleLLMError(error: Error, runId: string): Promise<void> {
		const run = this.runs[runId] ?? { index: Object.keys(this.runs).length, prompts: [] };
		this.ctx.addOutputData(
			NodeConnectionTypes.AiLanguageModel,
			run.index,
			error instanceof NodeError
				? error
				: new NodeOperationError(this.ctx.getNode(), error as unknown as JsonObject, {
						functionality: 'configuration-node',
					}),
		);
		this.logEvent('ai-llm-errored', { error: error.toString(), runId });
		delete this.runs[runId];
	}

	private logEvent(event: 'ai-llm-generated-output' | 'ai-llm-errored', data: unknown): void {
		try {
			this.ctx.logAiEvent(event, JSON.stringify(data));
		} catch {
			// logging must never break the LLM call
		}
	}
}
