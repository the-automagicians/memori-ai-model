import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class MemoriApi implements ICredentialType {
	name = 'memoriApi';

	displayName = 'Memori API';

	icon: ICredentialType['icon'] = 'file:memori.svg';

	documentationUrl = 'https://memori.ai/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'API key accepted by your self-hosted Memori instance',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://localhost:8000/v1',
			required: true,
			placeholder: 'https://memori.example.com/v1',
			description:
				'Base URL of your Memori OpenAI-compatible endpoint. Should end with /v1 (or the path your instance serves).',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/models',
			method: 'GET',
		},
	};
}
