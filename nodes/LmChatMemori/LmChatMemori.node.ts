import { ChatOpenAI, type ClientOptions } from '@langchain/openai';
import {
	NodeConnectionTypes,
	type ILoadOptionsFunctions,
	type INodeListSearchItems,
	type INodeListSearchResult,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

export class LmChatMemori implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Memori Chat Model',
		name: 'lmChatMemori',
		icon: 'file:memori.svg',
		group: ['transform'],
		version: 1,
		description:
			'OpenAI-compatible chat model that injects memori_attribution (entity_id, process_id, session_id) into every request for self-hosted Memori',
		defaults: {
			name: 'Memori Chat Model',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
				'Language Models': ['Chat Models (Recommended)'],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		credentials: [
			{
				name: 'memoriApi',
				required: true,
			},
		],
		properties: [
			{
				displayName:
					'This sub-node must be connected to an AI Agent (or other AI-capable node) to be used',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'resourceLocator',
				required: true,
				default: { mode: 'list', value: 'gpt-4o-mini' },
				description:
					'Model name as accepted by your Memori instance. Pick from the list loaded from /v1/models, or switch to "ID" to enter a custom alias.',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'searchModels',
							searchable: true,
							searchFilterRequired: false,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. gpt-4o-mini',
					},
				],
			},
			{
				displayName: 'Entity ID',
				name: 'entityId',
				type: 'string',
				default: '',
				required: true,
				description:
					'Memori entity (usually the end-user). Sent as memori_attribution.entity_id. Supports expressions referencing the incoming item.',
			},
			{
				displayName: 'Process ID',
				name: 'processId',
				type: 'string',
				default: 'n8n_agent',
				required: true,
				description: 'Logical application/process name. Sent as memori_attribution.process_id.',
			},
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '',
				required: true,
				description:
					'Conversation/session identifier. Sent as memori_attribution.session_id. Supports expressions referencing the incoming item.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Base URL Override',
						name: 'baseURL',
						type: 'string',
						default: '',
						description:
							'Overrides the Base URL from the credential. Typically your Memori instance, e.g. https://memori.example.com/v1.',
					},
					{
						displayName: 'Max Retries',
						name: 'maxRetries',
						type: 'number',
						default: 2,
						typeOptions: { minValue: 0 },
						description: 'Number of retries on transient failures',
					},
					{
						displayName: 'Maximum Number of Tokens',
						name: 'maxTokens',
						type: 'number',
						default: -1,
						typeOptions: { minValue: -1 },
						description: 'Maximum tokens to generate. -1 leaves it unset so the server decides.',
					},
					{
						displayName: 'Sampling Temperature',
						name: 'temperature',
						type: 'number',
						default: 0.7,
						typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
					},
					{
						displayName: 'Timeout',
						name: 'timeout',
						type: 'number',
						default: 360000,
						typeOptions: { minValue: 1 },
						description: 'HTTP request timeout in milliseconds',
					},
				],
			},
		],
	};

	methods = {
		listSearch: {
			async searchModels(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const credentials = await this.getCredentials('memoriApi');
				const baseUrl = ((credentials.baseUrl as string) ?? '').trim().replace(/\/+$/, '');
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'memoriApi',
					{ method: 'GET', url: `${baseUrl}/models`, json: true },
				)) as { data?: Array<{ id: string; owned_by?: string }> };

				const models = response.data ?? [];
				const needle = filter?.toLowerCase() ?? '';
				const results: INodeListSearchItems[] = models
					.filter((m) => !needle || m.id.toLowerCase().includes(needle))
					.map((m) => ({
						name: m.id,
						value: m.id,
						description: m.owned_by ? `owned_by: ${m.owned_by}` : undefined,
					}));

				return { results };
			},
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials('memoriApi');

		// Model is a resourceLocator — extractValue flattens { mode, value } to value.
		// Also tolerate old workflows that saved the field as a plain string.
		const rawModel = this.getNodeParameter('model', itemIndex, '', {
			extractValue: true,
		});
		const model =
			typeof rawModel === 'string'
				? rawModel
				: ((rawModel as { value?: string })?.value ?? '');
		const entityId = this.getNodeParameter('entityId', itemIndex) as string;
		const processId = this.getNodeParameter('processId', itemIndex) as string;
		const sessionId = this.getNodeParameter('sessionId', itemIndex) as string;

		const options = this.getNodeParameter('options', itemIndex, {}) as {
			baseURL?: string;
			temperature?: number;
			maxTokens?: number;
			timeout?: number;
			maxRetries?: number;
		};

		const configuration: ClientOptions = {
			baseURL: options.baseURL || (credentials.baseUrl as string),
			// Send attribution as both headers (what the hosted Memori / MCP Memori
			// expect) and as a body key (what self-hosted proxies read). Belt and
			// braces — either path alone is enough to partition memory.
			defaultHeaders: {
				'X-Memori-Entity-Id': entityId,
				'X-Memori-Process-Id': processId,
				'X-Memori-Session-Id': sessionId,
			},
			fetch: async (url, init) => {
				if (init?.body && typeof init.body === 'string') {
					try {
						const body = JSON.parse(init.body);
						delete body.top_p;
						delete body.n;
						delete body.presence_penalty;
						delete body.frequency_penalty;
						const newBody = JSON.stringify(body);
						// The OpenAI SDK stamps Content-Length on the original body. Drop
						// stale length/encoding headers so fetch recomputes them for the
						// rewritten body, otherwise undici aborts with "Connection error".
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const headers = new Headers(init.headers as any);
						headers.delete('content-length');
						headers.delete('content-encoding');
						init = { ...init, body: newBody, headers };
					} catch {
						// body wasn't JSON — leave it alone
					}
				}
				return fetch(url as Parameters<typeof fetch>[0], init as RequestInit);
			},
		};

		const maxTokens =
			options.maxTokens !== undefined && options.maxTokens > 0 ? options.maxTokens : undefined;

		const llm = new ChatOpenAI({
			apiKey: credentials.apiKey as string,
			model,
			temperature: options.temperature ?? 0.7,
			maxTokens,
			timeout: options.timeout ?? 360000,
			maxRetries: options.maxRetries ?? 2,
			configuration,
			modelKwargs: {
				memori_attribution: {
					entity_id: entityId,
					process_id: processId,
					session_id: sessionId,
				},
			},
		});

		return {
			response: llm,
		};
	}
}
