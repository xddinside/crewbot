/** Public MCP client metadata. Credential hashes never cross this boundary. */
export interface McpAccessClient {
  id: string;
  name: string;
  botIds: string[];
  readOnly: boolean;
  createdAt: number;
  revokedAt?: number;
}

/** Settings for the optional token-scoped Streamable HTTP endpoint. */
export interface McpAccessSettings {
  enabled: boolean;
  endpoint: string;
  clients: McpAccessClient[];
}
