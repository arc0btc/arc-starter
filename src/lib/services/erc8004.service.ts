/**
 * ERC-8004 Service
 *
 * Service for interacting with ERC-8004 identity, reputation, and validation contracts.
 * Deployed on mainnet and testnet with identical interfaces.
 */

import {
  ClarityValue,
  uintCV,
  intCV,
  stringUtf8CV,
  bufferCV,
  principalCV,
  listCV,
  tupleCV,
  boolCV,
  optionalCVOf,
  noneCV,
  cvToJSON,
  hexToCV,
} from "@stacks/transactions";
import { HiroApiService, getHiroApi } from "./hiro-api.js";
import { getErc8004Contracts, parseContractId, type Network } from "../config/index.js";
import { callContract, type Account, type TransferResult } from "../transactions/builder.js";
import { sponsoredContractCall } from "../transactions/sponsor-builder.js";
import { createNftSendPostCondition } from "../transactions/post-conditions.js";

// ============================================================================
// Types
// ============================================================================

export interface IdentityInfo {
  agentId: number;
  owner: string;
  uri: string;
  wallet?: string;
}

export interface ReputationSummary {
  agentId: number;
  totalFeedback: number;
  summaryValue: string;
  summaryValueDecimals: number;
}

export interface FeedbackEntry {
  client: string;
  value: number;
  valueDecimals: number;
  wadValue: string;
  tag1: string;
  tag2: string;
  isRevoked: boolean;
}

export interface FeedbackPageItem {
  client: string;
  index: number;
  value: number;
  valueDecimals: number;
  wadValue: string;
  tag1: string;
  tag2: string;
  isRevoked: boolean;
}

export interface FeedbackPage {
  items: FeedbackPageItem[];
  cursor?: number;
}

export interface ClientsPage {
  clients: string[];
  cursor?: number;
}

export interface ValidationsPage {
  /** Request hashes as hex strings (buff 32) */
  validations: string[];
  cursor?: number;
}

export interface ValidatorRequestsPage {
  /** Request hashes as hex strings (buff 32) */
  requests: string[];
  cursor?: number;
}

export interface ValidationStatus {
  validator: string;
  agentId: number;
  response: number;
  responseHash: string;
  tag: string;
  lastUpdate: number;
  hasResponse: boolean;
}

export interface ValidationSummary {
  count: number;
  avgResponse: number;
}

// ============================================================================
// ERC8004 Service
// ============================================================================

export class Erc8004Service {
  private hiro: HiroApiService;
  private contracts: ReturnType<typeof getErc8004Contracts>;

  constructor(private network: Network) {
    this.hiro = getHiroApi(network);
    this.contracts = getErc8004Contracts(network);
  }

  // ==========================================================================
  // Identity Registry
  // ==========================================================================

  /**
   * Register a new agent identity
   */
  async registerIdentity(
    account: Account,
    uri?: string,
    metadata?: Array<{ key: string; value: Buffer }>,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.identityRegistry);

    let functionName: string;
    let functionArgs: ClarityValue[];

    if (metadata && metadata.length > 0) {
      // Use register-full with metadata
      functionName = "register-full";
      functionArgs = [
        stringUtf8CV(uri || ""),
        listCV(
          metadata.map((m) =>
            tupleCV({
              key: stringUtf8CV(m.key),
              value: bufferCV(m.value),
            })
          )
        ),
      ];
    } else if (uri) {
      // Use register-with-uri
      functionName = "register-with-uri";
      functionArgs = [stringUtf8CV(uri)];
    } else {
      // Use basic register
      functionName = "register";
      functionArgs = [];
    }

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName,
      functionArgs,
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Get agent identity information
   */
  async getIdentity(agentId: number, callerAddress: string): Promise<IdentityInfo | null> {
    // Get owner
    const ownerResult = await this.hiro.callReadOnlyFunction(
      this.contracts.identityRegistry,
      "get-owner",
      [uintCV(agentId)],
      callerAddress
    );

    if (!ownerResult.okay || !ownerResult.result) {
      throw new Error(
        `Failed to read identity for agent ${agentId}: ${(ownerResult as any).cause || "read-only call failed"}`
      );
    }

    const ownerData = cvToJSON(hexToCV(ownerResult.result));
    if (!ownerData.success || ownerData.value.value === null) {
      return null; // Contract returned (none) — agent not found
    }

    const owner = ownerData.value.value.value;

    // Get URI
    const uriResult = await this.hiro.callReadOnlyFunction(
      this.contracts.identityRegistry,
      "get-uri",
      [uintCV(agentId)],
      callerAddress
    );

    let uri = "";
    if (uriResult.okay && uriResult.result) {
      const uriData = cvToJSON(hexToCV(uriResult.result));
      if (uriData.success && uriData.value.value !== null) {
        uri = uriData.value.value.value;
      }
    }

    // Get agent wallet
    const walletResult = await this.hiro.callReadOnlyFunction(
      this.contracts.identityRegistry,
      "get-agent-wallet",
      [uintCV(agentId)],
      callerAddress
    );

    let wallet: string | undefined;
    if (walletResult.okay && walletResult.result) {
      const walletData = cvToJSON(hexToCV(walletResult.result));
      if (walletData.success && walletData.value.value !== null) {
        wallet = walletData.value.value.value;
      }
    }

    return {
      agentId,
      owner,
      uri,
      wallet,
    };
  }

  /**
   * Update identity URI
   */
  async updateIdentityUri(
    account: Account,
    agentId: number,
    newUri: string,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.identityRegistry);

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "set-agent-uri",
      functionArgs: [uintCV(agentId), stringUtf8CV(newUri)],
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Set metadata on an agent identity
   * Key "agentWallet" is reserved and will be rejected by the contract.
   */
  async setMetadata(
    account: Account,
    agentId: number,
    key: string,
    value: Buffer,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.identityRegistry);

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "set-metadata",
      functionArgs: [uintCV(agentId), stringUtf8CV(key), bufferCV(value)],
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Set or revoke operator approval for an agent identity
   * Only the NFT owner can call this.
   */
  async setApprovalForAll(
    account: Account,
    agentId: number,
    operator: string,
    approved: boolean,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.identityRegistry);

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "set-approval-for-all",
      functionArgs: [uintCV(agentId), principalCV(operator), boolCV(approved)],
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Set tx-sender as the agent wallet for an agent identity (direct path, no signature required)
   * Caller must be the owner or an approved operator.
   */
  async setAgentWalletDirect(
    account: Account,
    agentId: number,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.identityRegistry);

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "set-agent-wallet-direct",
      functionArgs: [uintCV(agentId)],
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Remove the agent wallet association from an agent identity
   * Caller must be the owner or an approved operator.
   */
  async unsetAgentWallet(
    account: Account,
    agentId: number,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.identityRegistry);

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "unset-agent-wallet",
      functionArgs: [uintCV(agentId)],
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Transfer an agent identity NFT from sender to recipient
   * tx-sender must equal sender, and sender must be the current owner.
   * Transfer automatically clears the agent wallet.
   */
  async transferIdentity(
    account: Account,
    tokenId: number,
    sender: string,
    recipient: string,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.identityRegistry);

    const postConditions = [
      createNftSendPostCondition(
        sender,
        this.contracts.identityRegistry,
        "agent-identity",
        tokenId
      ),
    ];

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "transfer",
      functionArgs: [uintCV(tokenId), principalCV(sender), principalCV(recipient)],
      postConditions,
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Get metadata value for an agent identity key
   * Returns the raw buffer value as a hex string, or null if not set.
   */
  async getMetadata(agentId: number, key: string, callerAddress: string): Promise<string | null> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.identityRegistry,
      "get-metadata",
      [uintCV(agentId), stringUtf8CV(key)],
      callerAddress
    );

    if (!result.okay || !result.result) {
      return null;
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success || data.value.value === null) {
      return null; // (none) — key not set
    }

    return data.value.value;
  }

  /**
   * Get the last token ID (highest registered agent ID)
   * Returns null if no agents have been registered yet.
   */
  async getLastTokenId(callerAddress: string): Promise<number | null> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.identityRegistry,
      "get-last-token-id",
      [],
      callerAddress
    );

    if (!result.okay || !result.result) {
      return null;
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success) {
      return null;
    }

    // Contract returns (ok uint) on success, (err u1001) if no agents registered
    if (!data.value.success) {
      return null;
    }

    return parseInt(data.value.value.value, 10);
  }

  // ==========================================================================
  // Reputation Registry
  // ==========================================================================

  /**
   * Give feedback for an agent
   */
  async giveFeedback(
    account: Account,
    agentId: number,
    value: number,
    valueDecimals: number,
    tag1?: string,
    tag2?: string,
    endpoint?: string,
    feedbackUri?: string,
    feedbackHash?: Buffer,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.reputationRegistry);

    const functionArgs = [
      uintCV(agentId),
      intCV(value),
      uintCV(valueDecimals),
      stringUtf8CV(tag1 || ""),
      stringUtf8CV(tag2 || ""),
      stringUtf8CV(endpoint || ""),
      stringUtf8CV(feedbackUri || ""),
      bufferCV(feedbackHash || Buffer.alloc(32)),
    ];

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "give-feedback",
      functionArgs,
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Revoke previously given feedback
   * Only the original feedback client (tx-sender) can revoke their own feedback.
   */
  async revokeFeedback(
    account: Account,
    agentId: number,
    index: number,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.reputationRegistry);

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "revoke-feedback",
      functionArgs: [uintCV(agentId), uintCV(index)],
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Append a response to a feedback entry
   * Any principal can append a response; tracks unique responders per feedback entry.
   */
  async appendResponse(
    account: Account,
    agentId: number,
    client: string,
    index: number,
    responseUri: string,
    responseHash: Buffer,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.reputationRegistry);

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "append-response",
      functionArgs: [
        uintCV(agentId),
        principalCV(client),
        uintCV(index),
        stringUtf8CV(responseUri),
        bufferCV(responseHash),
      ],
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Approve a client to give feedback on an agent up to a specified index limit
   * Caller must be the agent owner or an approved operator.
   */
  async approveClient(
    account: Account,
    agentId: number,
    client: string,
    indexLimit: number,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.reputationRegistry);

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "approve-client",
      functionArgs: [uintCV(agentId), principalCV(client), uintCV(indexLimit)],
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Get aggregated reputation for an agent
   */
  async getReputation(agentId: number, callerAddress: string): Promise<ReputationSummary> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.reputationRegistry,
      "get-summary",
      [uintCV(agentId)],
      callerAddress
    );

    if (!result.okay || !result.result) {
      throw new Error(
        `Failed to read reputation for agent ${agentId}: ${result.cause || "unknown error"}`
      );
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success) {
      throw new Error(
        `Failed to parse reputation response for agent ${agentId}`
      );
    }

    const rep = data.value.value;
    return {
      agentId,
      totalFeedback: parseInt(rep.count.value, 10),
      summaryValue: rep["summary-value"].value,
      summaryValueDecimals: parseInt(rep["summary-value-decimals"].value, 10),
    };
  }

  /**
   * Get total feedback count for an agent
   */
  async getFeedbackCount(agentId: number, callerAddress: string): Promise<number> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.reputationRegistry,
      "get-agent-feedback-count",
      [uintCV(agentId)],
      callerAddress
    );

    if (!result.okay || !result.result) {
      return 0;
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success) {
      return 0;
    }

    return parseInt(data.value.value, 10);
  }

  /**
   * Get specific feedback entry by client and index
   *
   * Uses `read-feedback (agent-id uint) (client principal) (index uint)` from the
   * reputation registry. The feedback map is keyed by {agent-id, client, index},
   * so both the client principal and the index are required to retrieve an entry.
   */
  async getFeedback(
    agentId: number,
    client: string,
    index: number,
    callerAddress: string
  ): Promise<FeedbackEntry | null> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.reputationRegistry,
      "read-feedback",
      [uintCV(agentId), principalCV(client), uintCV(index)],
      callerAddress
    );

    if (!result.okay || !result.result) {
      return null;
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success || data.value.value === null) {
      return null;
    }

    const fb = data.value.value;
    return {
      client,
      value: parseInt(fb.value.value, 10),
      valueDecimals: parseInt(fb["value-decimals"].value, 10),
      wadValue: fb["wad-value"].value,
      tag1: fb.tag1.value,
      tag2: fb.tag2.value,
      isRevoked: fb["is-revoked"].value,
    };
  }

  /**
   * Read a paginated page of all feedback for an agent
   * Supports optional tag filtering and cursor-based pagination (page size: 14).
   */
  async readAllFeedback(
    agentId: number,
    callerAddress: string,
    tag1?: string,
    tag2?: string,
    includeRevoked?: boolean,
    cursor?: number
  ): Promise<FeedbackPage> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.reputationRegistry,
      "read-all-feedback",
      [
        uintCV(agentId),
        tag1 !== undefined ? optionalCVOf(stringUtf8CV(tag1)) : noneCV(),
        tag2 !== undefined ? optionalCVOf(stringUtf8CV(tag2)) : noneCV(),
        boolCV(includeRevoked ?? false),
        cursor !== undefined ? optionalCVOf(uintCV(cursor)) : noneCV(),
      ],
      callerAddress
    );

    if (!result.okay || !result.result) {
      throw new Error(
        `Failed to read all feedback for agent ${agentId}: ${(result as any).cause || "read-only call failed"}`
      );
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success) {
      throw new Error(`Failed to parse feedback page for agent ${agentId}`);
    }

    const page = data.value.value;
    const items: FeedbackPageItem[] = (page.items.value || []).map((item: any) => ({
      client: item.value.client.value,
      index: parseInt(item.value.index.value, 10),
      value: parseInt(item.value.value.value, 10),
      valueDecimals: parseInt(item.value["value-decimals"].value, 10),
      wadValue: item.value["wad-value"].value,
      tag1: item.value.tag1.value,
      tag2: item.value.tag2.value,
      isRevoked: item.value["is-revoked"].value,
    }));

    const cursorValue =
      page.cursor.value !== null && page.cursor.value !== undefined
        ? parseInt(page.cursor.value.value, 10)
        : undefined;

    return { items, cursor: cursorValue };
  }

  /**
   * Get paginated list of clients that have given feedback for an agent
   * Cursor-based pagination with page size 14.
   */
  async getClients(
    agentId: number,
    callerAddress: string,
    cursor?: number
  ): Promise<ClientsPage> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.reputationRegistry,
      "get-clients",
      [uintCV(agentId), cursor !== undefined ? optionalCVOf(uintCV(cursor)) : noneCV()],
      callerAddress
    );

    if (!result.okay || !result.result) {
      throw new Error(
        `Failed to get clients for agent ${agentId}: ${(result as any).cause || "read-only call failed"}`
      );
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success) {
      throw new Error(`Failed to parse clients page for agent ${agentId}`);
    }

    const page = data.value.value;
    const clients: string[] = (page.clients.value || []).map((item: any) => item.value);

    const cursorValue =
      page.cursor.value !== null && page.cursor.value !== undefined
        ? parseInt(page.cursor.value.value, 10)
        : undefined;

    return { clients, cursor: cursorValue };
  }

  /**
   * Get the approved feedback index limit for a client on an agent
   * Returns 0 if the client has no approval.
   */
  async getApprovedLimit(agentId: number, client: string, callerAddress: string): Promise<number> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.reputationRegistry,
      "get-approved-limit",
      [uintCV(agentId), principalCV(client)],
      callerAddress
    );

    if (!result.okay || !result.result) {
      return 0;
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success) {
      return 0;
    }

    return parseInt(data.value.value, 10);
  }

  /**
   * Get the last feedback index for a client on an agent
   * Returns 0 if the client has not given any feedback.
   */
  async getLastIndex(agentId: number, client: string, callerAddress: string): Promise<number> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.reputationRegistry,
      "get-last-index",
      [uintCV(agentId), principalCV(client)],
      callerAddress
    );

    if (!result.okay || !result.result) {
      return 0;
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success) {
      return 0;
    }

    return parseInt(data.value.value, 10);
  }

  // ==========================================================================
  // Validation Registry
  // ==========================================================================

  /**
   * Request validation from a validator
   */
  async requestValidation(
    account: Account,
    validator: string,
    agentId: number,
    requestUri: string,
    requestHash: Buffer,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.validationRegistry);

    const functionArgs = [
      principalCV(validator),
      uintCV(agentId),
      stringUtf8CV(requestUri),
      bufferCV(requestHash),
    ];

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "validation-request",
      functionArgs,
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Submit a validation response for a pending request
   * Only the validator specified in the original request can respond.
   * Response must be 0-100. Can be called multiple times (progressive updates).
   */
  async submitValidationResponse(
    account: Account,
    requestHash: Buffer,
    response: number,
    responseUri: string,
    responseHash: Buffer,
    tag: string,
    fee?: bigint,
    sponsored?: boolean
  ): Promise<TransferResult> {
    const { address, name } = parseContractId(this.contracts.validationRegistry);

    const contractCallOptions = {
      contractAddress: address,
      contractName: name,
      functionName: "validation-response",
      functionArgs: [
        bufferCV(requestHash),
        uintCV(response),
        stringUtf8CV(responseUri),
        bufferCV(responseHash),
        stringUtf8CV(tag),
      ],
      fee,
    };

    if (sponsored) {
      return sponsoredContractCall(account, contractCallOptions, this.network);
    }

    return callContract(account, contractCallOptions);
  }

  /**
   * Get validation status for a request
   */
  async getValidationStatus(
    requestHash: Buffer,
    callerAddress: string
  ): Promise<ValidationStatus | null> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.validationRegistry,
      "get-validation-status",
      [bufferCV(requestHash)],
      callerAddress
    );

    if (!result.okay || !result.result) {
      return null;
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success || data.value.value === null) {
      return null;
    }

    const vs = data.value.value.value;
    return {
      validator: vs.validator.value,
      agentId: parseInt(vs["agent-id"].value, 10),
      response: parseInt(vs.response.value, 10),
      responseHash: vs["response-hash"].value,
      tag: vs.tag.value,
      lastUpdate: parseInt(vs["last-update"].value, 10),
      hasResponse: vs["has-response"].value,
    };
  }

  /**
   * Get validation summary for an agent
   */
  async getValidationSummary(
    agentId: number,
    callerAddress: string
  ): Promise<ValidationSummary> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.validationRegistry,
      "get-summary",
      [uintCV(agentId)],
      callerAddress
    );

    if (!result.okay || !result.result) {
      throw new Error(
        `Failed to read validation summary for agent ${agentId}: ${(result as any).cause || "read-only call failed"}`
      );
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success) {
      throw new Error(
        `Failed to parse validation summary for agent ${agentId}`
      );
    }

    const summary = data.value.value;
    return {
      count: parseInt(summary.count.value, 10),
      avgResponse: parseInt(summary["avg-response"].value, 10),
    };
  }

  /**
   * Get paginated list of validation request hashes for an agent
   * Returns request hashes as hex strings. Cursor-based pagination with page size 14.
   */
  async getAgentValidations(
    agentId: number,
    callerAddress: string,
    cursor?: number
  ): Promise<ValidationsPage> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.validationRegistry,
      "get-agent-validations",
      [uintCV(agentId), cursor !== undefined ? optionalCVOf(uintCV(cursor)) : noneCV()],
      callerAddress
    );

    if (!result.okay || !result.result) {
      throw new Error(
        `Failed to get agent validations for agent ${agentId}: ${(result as any).cause || "read-only call failed"}`
      );
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success) {
      throw new Error(`Failed to parse agent validations for agent ${agentId}`);
    }

    const page = data.value.value;
    const validations: string[] = (page.validations.value || []).map((item: any) => item.value);

    const cursorValue =
      page.cursor.value !== null && page.cursor.value !== undefined
        ? parseInt(page.cursor.value.value, 10)
        : undefined;

    return { validations, cursor: cursorValue };
  }

  /**
   * Get paginated list of validation request hashes submitted to a validator
   * Returns request hashes as hex strings. Cursor-based pagination with page size 14.
   */
  async getValidatorRequests(
    validator: string,
    callerAddress: string,
    cursor?: number
  ): Promise<ValidatorRequestsPage> {
    const result = await this.hiro.callReadOnlyFunction(
      this.contracts.validationRegistry,
      "get-validator-requests",
      [principalCV(validator), cursor !== undefined ? optionalCVOf(uintCV(cursor)) : noneCV()],
      callerAddress
    );

    if (!result.okay || !result.result) {
      throw new Error(
        `Failed to get validator requests for ${validator}: ${(result as any).cause || "read-only call failed"}`
      );
    }

    const data = cvToJSON(hexToCV(result.result));
    if (!data.success) {
      throw new Error(`Failed to parse validator requests for ${validator}`);
    }

    const page = data.value.value;
    const requests: string[] = (page.requests.value || []).map((item: any) => item.value);

    const cursorValue =
      page.cursor.value !== null && page.cursor.value !== undefined
        ? parseInt(page.cursor.value.value, 10)
        : undefined;

    return { requests, cursor: cursorValue };
  }
}
