/*
 *
 * Hedera Wallet Connect
 *
 * Copyright (C) 2023 Hedera Hashgraph, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import {
  AccountBalanceQuery,
  AccountCreateTransaction,
  AccountId,
  AccountInfoQuery,
  AccountRecordsQuery,
  AccountUpdateTransaction,
  LedgerId,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TopicCreateTransaction,
  TransactionId,
  Transaction,
  Client,
  TransactionReceiptQuery,
  TransactionRecordQuery,
  AccountInfo,
  TransactionRecord,
  TransactionReceipt,
  AccountBalance,
  FileInfoQuery,
} from '@hashgraph/sdk'
import { proto } from '@hashgraph/proto'
import {
  DAppConnector,
  HederaJsonRpcMethod,
  SignAndExecuteTransactionParams,
  transactionToBase64String,
  DAppSigner,
  SignAndExecuteTransactionResult,
  ExecuteTransactionResult,
  SignAndExecuteQueryResult,
  SignAndExecuteQueryParams,
  Uint8ArrayToBase64String,
  base64StringToQuery,
} from '../../src'
import {
  projectId,
  dAppMetadata,
  useJsonFixture,
  prepareTestTransaction,
  prepareTestQuery,
} from '../_helpers'
import { ISignClient, SessionTypes } from '@walletconnect/types'
import Long from 'long'

jest.mock('../../src/lib/shared/extensionController', () => ({
  extensionOpen: jest.fn(),
}))

jest.mock('../../src/lib/shared/utils', () => ({
  ...jest.requireActual('../../src/lib/shared/utils'),
  findExtensions: jest.fn(),
}))

describe('DAppSigner', () => {
  let connector: DAppConnector
  const fakeSession = useJsonFixture('fakeSession') as SessionTypes.Struct
  let signer: DAppSigner
  let mockSignClient: jest.Mocked<ISignClient>
  const testAccountId = AccountId.fromString('0.0.123')
  const testTopic = 'test-topic'
  const testExtensionId = 'test-extension-id'

  beforeEach(() => {
    connector = new DAppConnector(dAppMetadata, LedgerId.TESTNET, projectId)
    // @ts-ignore
    connector.signers = connector.createSigners(fakeSession)
    signer = connector.signers[0]

    mockSignClient = {
      request: jest.fn(),
      metadata: dAppMetadata,
    } as any

    signer = new DAppSigner(
      testAccountId,
      mockSignClient,
      testTopic,
      LedgerId.TESTNET,
      testExtensionId,
    )
  })

  afterEach(() => {
    global.gc && global.gc()
  })

  describe(DAppSigner.prototype.call, () => {
    let signerRequestSpy: jest.SpyInstance

    beforeEach(async () => {
      signerRequestSpy = jest.spyOn(signer, 'request')
      signerRequestSpy.mockImplementation((request: { method: string; params: any }) => {
        const { method } = request
        if (method === HederaJsonRpcMethod.SignAndExecuteTransaction) {
          const response: SignAndExecuteTransactionResult['result'] = {
            transactionId: TransactionId.generate('0.0.999').toString(),
            nodeId: '0.0.3',
            transactionHash: '0x',
          }
          return Promise.resolve(response)
        } else if (method === HederaJsonRpcMethod.ExecuteTransaction) {
          const response: ExecuteTransactionResult['result'] = {
            transactionId: TransactionId.generate('0.0.999').toString(),
            nodeId: '0.0.3',
            transactionHash: '0x',
          }
          return Promise.resolve(response)
        } else if (method === HederaJsonRpcMethod.SignAndExecuteQuery) {
          const query = base64StringToQuery(request.params.query)
          let queryResponse = 'ERROR: Unsupported query type'
          if (query instanceof AccountBalanceQuery) {
            queryResponse = Uint8ArrayToBase64String(
              proto.CryptoGetAccountBalanceResponse.encode({
                balance: Long.fromNumber(0),
              }).finish(),
            )
          } else if (query instanceof AccountInfoQuery) {
            queryResponse = Uint8ArrayToBase64String(
              proto.CryptoGetInfoResponse.AccountInfo.encode({
                accountID: {
                  shardNum: Long.fromNumber(0),
                  realmNum: Long.fromNumber(0),
                  accountNum: Long.fromNumber(3),
                },
                contractAccountID: AccountId.fromString('0.0.3').toSolidityAddress(),
                key: {
                  ed25519: PrivateKey.generate().publicKey.toBytes(),
                },
                expirationTime: { seconds: Long.fromNumber(0), nanos: 1 },
              }).finish(),
            )
          } else if (query instanceof AccountRecordsQuery) {
            queryResponse = Uint8ArrayToBase64String(
              proto.TransactionGetRecordResponse.encode({
                transactionRecord: {
                  alias: proto.Key.encode(
                    PrivateKey.generate().publicKey._toProtobufKey(),
                  ).finish(),
                  receipt: {
                    status: proto.ResponseCodeEnum.OK,
                    accountID: {
                      shardNum: Long.fromNumber(0),
                      realmNum: Long.fromNumber(0),
                      accountNum: Long.fromNumber(3),
                    },
                  },
                  consensusTimestamp: { seconds: Long.fromNumber(0), nanos: 1 },
                  transactionID: {
                    accountID: {
                      shardNum: Long.fromNumber(0),
                      realmNum: Long.fromNumber(0),
                      accountNum: Long.fromNumber(3),
                    },
                    transactionValidStart: { seconds: Long.fromNumber(0), nanos: 1 },
                    nonce: 1,
                  },
                },
              }).finish(),
            )
          }
          const response: SignAndExecuteQueryResult['result'] = {
            response: queryResponse,
          }
          return Promise.resolve(response)
        }
      })
    })

    afterEach(() => {
      if (signerRequestSpy) {
        signerRequestSpy.mockRestore()
      }
    })

    it.each([
      { name: AccountCreateTransaction.name, ExecutableType: AccountCreateTransaction },
      { name: AccountUpdateTransaction.name, ExecutableType: AccountUpdateTransaction },
      { name: TopicCreateTransaction.name, ExecutableType: TopicCreateTransaction },
      { name: TokenAssociateTransaction.name, ExecutableType: TokenAssociateTransaction },
      { name: TokenCreateTransaction.name, ExecutableType: TokenCreateTransaction },
    ])('can execute $name transaction', async ({ name, ExecutableType }) => {
      const transaction = prepareTestTransaction(new ExecutableType(), { freeze: true })

      const params: SignAndExecuteTransactionParams = {
        signerAccountId: 'hedera:testnet:' + signer.getAccountId().toString(),
        transactionList: transactionToBase64String(transaction),
      }
      await signer.call(transaction)

      expect(signerRequestSpy).toHaveBeenCalled()
      expect(signerRequestSpy).toHaveBeenCalledTimes(1)
      expect(signerRequestSpy).toHaveBeenCalledWith({
        method: HederaJsonRpcMethod.SignAndExecuteTransaction,
        params,
      })
    })

    it.each([
      { name: AccountBalanceQuery.name, ExecutableType: AccountBalanceQuery },
      { name: AccountInfoQuery.name, ExecutableType: AccountInfoQuery },
      { name: AccountRecordsQuery.name, ExecutableType: AccountRecordsQuery },
    ])('can execute $name query', async ({ name, ExecutableType }) => {
      const query = prepareTestQuery<any, any>(new ExecutableType())

      const params: SignAndExecuteQueryParams = {
        signerAccountId: 'hedera:testnet:' + signer.getAccountId().toString(),
        query: Uint8ArrayToBase64String(query.toBytes()),
      }
      await signer.call(query)

      expect(signerRequestSpy).toHaveBeenCalled()
      expect(signerRequestSpy).toHaveBeenCalledTimes(1)
      expect(signerRequestSpy).toHaveBeenCalledWith({
        method: HederaJsonRpcMethod.SignAndExecuteQuery,
        params,
      })
    })
  })

  describe('sign', () => {
    let signerRequestSpy: jest.SpyInstance

    beforeEach(() => {
      signerRequestSpy = jest.spyOn(signer, 'request')
    })

    afterEach(() => {
      signerRequestSpy.mockRestore()
    })

    it('should sign a message', async () => {
      const mockPublicKey = PrivateKey.generate().publicKey
      const mockSignature = new Uint8Array([1, 2, 3])

      signerRequestSpy.mockImplementation(() =>
        Promise.resolve({
          signatureMap: Uint8ArrayToBase64String(
            proto.SignatureMap.encode({
              sigPair: [
                {
                  pubKeyPrefix: mockPublicKey.toBytes(),
                  ed25519: mockSignature,
                },
              ],
            }).finish(),
          ),
        }),
      )

      const message = new Uint8Array([4, 5, 6])
      const signatures = await signer.sign([message])

      expect(signatures).toHaveLength(1)
      expect(signatures[0].accountId.toString()).toBe(signer.getAccountId().toString())
      expect(Array.from(signatures[0].signature)).toEqual(Array.from(mockSignature))
      expect(signerRequestSpy).toHaveBeenCalledWith({
        method: HederaJsonRpcMethod.SignMessage,
        params: {
          signerAccountId: 'hedera:testnet:' + signer.getAccountId().toString(),
          message: Uint8ArrayToBase64String(message),
        },
      })
    })
  })

  describe('signTransaction', () => {
    let signerRequestSpy: jest.SpyInstance

    beforeEach(() => {
      signerRequestSpy = jest.spyOn(signer, 'request')
    })

    afterEach(() => {
      signerRequestSpy.mockRestore()
    })

    it('should sign a transaction', async () => {
      const mockPublicKey = PrivateKey.generate().publicKey
      const mockSignature = new Uint8Array([1, 2, 3])

      signerRequestSpy.mockImplementation(() =>
        Promise.resolve({
          signatureMap: Uint8ArrayToBase64String(
            proto.SignatureMap.encode({
              sigPair: [
                {
                  pubKeyPrefix: mockPublicKey.toBytes(),
                  ed25519: mockSignature,
                },
              ],
            }).finish(),
          ),
        }),
      )

      const transaction = prepareTestTransaction(new AccountCreateTransaction(), {
        freeze: true,
      })
      const signedTx = await signer.signTransaction(transaction)

      expect(signedTx).toBeDefined()
      expect(signerRequestSpy).toHaveBeenCalledWith({
        method: HederaJsonRpcMethod.SignTransaction,
        params: expect.objectContaining({
          signerAccountId: 'hedera:testnet:' + signer.getAccountId().toString(),
          transactionBody: expect.any(String),
        }),
      })
    })
  })

  describe('getAccountKey()', () => {
    let signerRequestSpy: jest.SpyInstance

    beforeEach(() => {
      signerRequestSpy = jest.spyOn(signer, 'request')
    })

    afterEach(() => {
      signerRequestSpy.mockRestore()
    })

    it('should throw error as method is not implemented', () => {
      expect(() => signer.getAccountKey()).toThrow('Method not implemented.')
    })
  })

  describe('network configuration', () => {
    let signerRequestSpy: jest.SpyInstance

    beforeEach(() => {
      signerRequestSpy = jest.spyOn(signer, 'request')
    })

    afterEach(() => {
      signerRequestSpy.mockRestore()
    })

    it('should return network configuration from client', () => {
      const network = signer.getNetwork()
      expect(network).toBeDefined()
      expect(Object.keys(network).length).toBeGreaterThan(0)
    })

    it('should return mirror network configuration from client', () => {
      const mirrorNetwork = signer.getMirrorNetwork()
      expect(Array.isArray(mirrorNetwork)).toBe(true)
    })
  })

  describe('getMetadata()', () => {
    let signerRequestSpy: jest.SpyInstance

    beforeEach(() => {
      signerRequestSpy = jest.spyOn(signer, 'request')
    })

    afterEach(() => {
      signerRequestSpy.mockRestore()
    })

    it('should return dApp metadata', () => {
      const metadata = signer.getMetadata()
      expect(metadata).toEqual(dAppMetadata)
    })
  })

  describe('_getHederaClient', () => {
    it('should create and cache client for ledger', () => {
      const client1 = (signer as any)._getHederaClient()
      const client2 = (signer as any)._getHederaClient()
      expect(client1).toBe(client2)
      expect(client1).toBeInstanceOf(Client)
    })
  })

  describe('_getRandomNodes', () => {
    it('should return random subset of nodes', () => {
      const nodes = (signer as any)._getRandomNodes(3)
      expect(nodes).toHaveLength(3)
      expect(nodes[0]).toBeInstanceOf(AccountId)
    })
  })

  describe('checkTransaction', () => {
    it('should throw not implemented error', async () => {
      await expect(signer.checkTransaction({} as Transaction)).rejects.toThrow(
        'Method not implemented.',
      )
    })
  })

  describe('populateTransaction', () => {
    it('should populate transaction with node accounts and transaction id', async () => {
      const mockTx = {
        setNodeAccountIds: jest.fn().mockReturnThis(),
        setTransactionId: jest.fn().mockReturnThis(),
      } as any

      const result = await signer.populateTransaction(mockTx)

      expect(mockTx.setNodeAccountIds).toHaveBeenCalled()
      expect(mockTx.setTransactionId).toHaveBeenCalled()
      expect(result).toBe(mockTx)
    })
  })

  describe('_parseQueryResponse', () => {
    it('should handle all supported query types', async () => {
      // Test AccountBalanceQuery
      const mockAccountBalance = proto.CryptoGetAccountBalanceResponse.encode({
        header: {
          nodeTransactionPrecheckCode: proto.ResponseCodeEnum.OK,
        },
        balance: Long.fromNumber(100),
        tokenBalances: [],
      }).finish()

      const balanceQuery = new AccountBalanceQuery()
      const balanceResponse = Uint8ArrayToBase64String(mockAccountBalance)
      const balanceResult = await (signer as any)._parseQueryResponse(
        balanceQuery,
        balanceResponse,
      )
      expect(balanceResult).toBeDefined()
      expect(balanceResult).toBeInstanceOf(AccountBalance)

      // Test AccountInfoQuery
      const mockAccountInfo = proto.CryptoGetInfoResponse.AccountInfo.encode({
        accountID: {
          shardNum: Long.fromNumber(0),
          realmNum: Long.fromNumber(0),
          accountNum: Long.fromNumber(123),
        },
        contractAccountID: '',
        deleted: false,
        proxyAccountID: null,
        proxyReceived: Long.ZERO,
        key: {
          ed25519: PrivateKey.generate().publicKey.toBytes(),
        },
        balance: Long.fromNumber(100),
        receiverSigRequired: false,
        expirationTime: { seconds: Long.fromNumber(Date.now() / 1000 + 7776000) },
        autoRenewPeriod: { seconds: Long.fromNumber(7776000) },
        memo: '',
        maxAutomaticTokenAssociations: 0,
        alias: new Uint8Array([]),
        ledgerId: new Uint8Array([]),
        ethereumNonce: Long.fromNumber(0),
        stakingInfo: null,
      }).finish()

      const infoQuery = new AccountInfoQuery()
      const infoResponse = Uint8ArrayToBase64String(mockAccountInfo)
      const infoResult = await (signer as any)._parseQueryResponse(infoQuery, infoResponse)
      expect(infoResult).toBeDefined()
      expect(infoResult).toBeInstanceOf(AccountInfo)

      // Test AccountRecordsQuery
      const mockTransactionRecord = proto.TransactionGetRecordResponse.encode({
        header: {
          nodeTransactionPrecheckCode: proto.ResponseCodeEnum.OK,
        },
        transactionRecord: {
          receipt: {
            status: proto.ResponseCodeEnum.SUCCESS,
            accountID: {
              shardNum: Long.fromNumber(0),
              realmNum: Long.fromNumber(0),
              accountNum: Long.fromNumber(123),
            },
          },
          transactionHash: new Uint8Array([1, 2, 3]),
          consensusTimestamp: { seconds: Long.fromNumber(Date.now() / 1000) },
          transactionID: {
            transactionValidStart: { seconds: Long.fromNumber(Date.now() / 1000) },
            accountID: {
              shardNum: Long.fromNumber(0),
              realmNum: Long.fromNumber(0),
              accountNum: Long.fromNumber(123),
            },
          },
          memo: '',
          transactionFee: Long.fromNumber(100000),
        },
      }).finish()

      const recordsQuery = new AccountRecordsQuery()
      const recordsResponse = Uint8ArrayToBase64String(mockTransactionRecord)
      const recordsResult = await (signer as any)._parseQueryResponse(
        recordsQuery,
        recordsResponse,
      )
      expect(recordsResult).toBeDefined()
      expect(Array.isArray(recordsResult)).toBe(true)

      // Test TransactionReceiptQuery
      const mockTransactionReceipt = proto.TransactionGetReceiptResponse.encode({
        header: {
          nodeTransactionPrecheckCode: proto.ResponseCodeEnum.OK,
        },
        receipt: {
          status: proto.ResponseCodeEnum.SUCCESS,
          accountID: {
            shardNum: Long.fromNumber(0),
            realmNum: Long.fromNumber(0),
            accountNum: Long.fromNumber(123),
          },
          topicRunningHash: new Uint8Array([1, 2, 3]),
          topicSequenceNumber: Long.fromNumber(1),
          exchangeRate: {
            currentRate: {
              hbarEquiv: 1,
              centEquiv: 12,
              expirationTime: { seconds: Long.fromNumber(Date.now() / 1000) },
            },
          },
        },
      }).finish()

      const receiptQuery = new TransactionReceiptQuery()
      const receiptResponse = Uint8ArrayToBase64String(mockTransactionReceipt)
      const receiptResult = await (signer as any)._parseQueryResponse(
        receiptQuery,
        receiptResponse,
      )
      expect(receiptResult).toBeDefined()
      expect(receiptResult).toBeInstanceOf(TransactionReceipt)

      // Test TransactionRecordQuery
      const txRecordQuery = new TransactionRecordQuery()
      const txRecordResponse = Uint8ArrayToBase64String(mockTransactionRecord)
      const txRecordResult = await (signer as any)._parseQueryResponse(
        txRecordQuery,
        txRecordResponse,
      )
      expect(txRecordResult).toBeDefined()
      expect(txRecordResult).toBeInstanceOf(TransactionRecord)
    })
    it('should throw error when query type is not supported', async () => {
      const unsupportedQuery = new FileInfoQuery()
      await expect((signer as any)._parseQueryResponse(unsupportedQuery, '')).rejects.toThrow(
        'Unsupported query type',
      )
    })
  })

  describe('call', () => {
    it('should throw error when both transaction and query execution fail', async () => {
      const mockRequest = {
        toBytes: () => new Uint8Array([1, 2, 3]),
      } as any

      mockSignClient.request
        .mockRejectedValueOnce(new Error('Transaction failed'))
        .mockRejectedValueOnce(new Error('Query failed'))

      await expect(signer.call(mockRequest)).rejects.toThrow(
        /Error executing transaction or query/,
      )
    })
  })

  describe('signTransaction', () => {
    it('should handle transaction without node account ids', async () => {
      // Create valid protobuf-encoded transaction
      const mockTxBody = proto.TransactionBody.encode({
        transactionID: {
          accountID: { accountNum: Long.fromNumber(800) },
          transactionValidStart: {
            seconds: Long.fromNumber(Date.now() / 1000),
            nanos: 0,
          },
        },
        nodeAccountID: { accountNum: Long.fromNumber(3) },
        transactionFee: Long.fromNumber(100000),
        transactionValidDuration: { seconds: Long.fromNumber(120) },
        cryptoCreateAccount: {
          key: { ed25519: PrivateKey.generate().publicKey.toBytes() },
        },
      }).finish()

      const mockTx = {
        nodeAccountIds: [],
        toBytes: () => new Uint8Array([1, 2, 3]),
        _signedTransactions: {
          current: {
            bodyBytes: mockTxBody,
          },
        },
      } as any

      const key = PrivateKey.generate()

      mockSignClient.request.mockResolvedValueOnce({
        signatureMap: Uint8ArrayToBase64String(
          proto.SignatureMap.encode({
            sigPair: [
              {
                pubKeyPrefix: key.publicKey.toBytes(),
                ed25519: key.toBytes(),
              },
            ],
          }).finish(),
        ),
      })

      await signer.signTransaction(mockTx)

      expect(mockSignClient.request).toHaveBeenCalledWith({
        topic: testTopic,
        request: {
          method: HederaJsonRpcMethod.SignTransaction,
          params: expect.any(Object),
        },
        chainId: expect.any(String),
      })
    })

    it('should throw error when transaction body serialization fails', async () => {
      const mockTx = {
        nodeAccountIds: [AccountId.fromString('0.0.3')],
        _signedTransactions: {
          current: {}, // This will cause bodyBytes to be undefined
        },
      } as any

      await expect(signer.signTransaction(mockTx)).rejects.toThrow(
        'Failed to serialize transaction body',
      )
    })
  })

  describe('request', () => {
    it('should call extensionOpen when extensionId is provided', async () => {
      const mockRequest = {
        method: 'test-method',
        params: { test: 'params' },
      }

      const { extensionOpen } = require('../../src/lib/shared/extensionController')
      await signer.request(mockRequest)
      expect(extensionOpen).toHaveBeenCalledWith(testExtensionId)
    })
  })

  describe('account queries', () => {
    let signerRequestSpy: jest.SpyInstance

    beforeEach(() => {
      signerRequestSpy = jest.spyOn(signer, 'request')
    })

    afterEach(() => {
      signerRequestSpy.mockRestore()
    })

    it('should get account balance', async () => {
      const mockBalance = proto.CryptoGetAccountBalanceResponse.encode({
        header: {
          nodeTransactionPrecheckCode: proto.ResponseCodeEnum.OK,
        },
        balance: Long.fromNumber(100),
        tokenBalances: [],
      }).finish()

      signerRequestSpy.mockResolvedValueOnce({
        response: Uint8ArrayToBase64String(mockBalance),
      })

      const balance = await signer.getAccountBalance()
      expect(balance).toBeInstanceOf(AccountBalance)
      expect(signerRequestSpy).toHaveBeenCalledWith({
        method: HederaJsonRpcMethod.SignAndExecuteQuery,
        params: expect.objectContaining({
          signerAccountId: 'hedera:testnet:' + signer.getAccountId().toString(),
        }),
      })
    })

    it('should get ledger id', async () => {
      const ledgerId = await signer.getLedgerId()
      expect(ledgerId).toBeDefined()
      expect(ledgerId.toString()).toBe('testnet')
    })

    it('should get account info', async () => {
      const mockInfo = proto.CryptoGetInfoResponse.AccountInfo.encode({
        accountID: {
          shardNum: Long.fromNumber(0),
          realmNum: Long.fromNumber(0),
          accountNum: Long.fromNumber(123),
        },
        contractAccountID: null,
        deleted: false,
        proxyAccountID: null,
        proxyReceived: Long.ZERO,
        key: {
          ed25519: PrivateKey.generate().publicKey.toBytes(),
        },
        balance: Long.fromNumber(100),
        receiverSigRequired: false,
        expirationTime: { seconds: Long.fromNumber(Date.now() / 1000 + 7776000) },
        autoRenewPeriod: { seconds: Long.fromNumber(7776000) },
        memo: '',
        maxAutomaticTokenAssociations: 0,
        alias: new Uint8Array([]),
        ledgerId: new Uint8Array([]),
        ethereumNonce: Long.fromNumber(0),
        stakingInfo: null,
      }).finish()

      signerRequestSpy.mockResolvedValueOnce({
        response: Uint8ArrayToBase64String(mockInfo),
      })

      const info = await signer.getAccountInfo()
      expect(info).toBeInstanceOf(AccountInfo)
      expect(signerRequestSpy).toHaveBeenCalledWith({
        method: HederaJsonRpcMethod.SignAndExecuteQuery,
        params: expect.objectContaining({
          signerAccountId: 'hedera:testnet:' + signer.getAccountId().toString(),
        }),
      })
    })

    it('should get account records', async () => {
      const mockRecords = proto.TransactionGetRecordResponse.encode({
        header: {
          nodeTransactionPrecheckCode: proto.ResponseCodeEnum.OK,
        },
        transactionRecord: {
          receipt: {
            status: proto.ResponseCodeEnum.SUCCESS,
            accountID: {
              shardNum: Long.fromNumber(0),
              realmNum: Long.fromNumber(0),
              accountNum: Long.fromNumber(123),
            },
          },
          transactionHash: new Uint8Array([1, 2, 3]),
          consensusTimestamp: { seconds: Long.fromNumber(Date.now() / 1000) },
          transactionID: {
            transactionValidStart: { seconds: Long.fromNumber(Date.now() / 1000) },
            accountID: {
              shardNum: Long.fromNumber(0),
              realmNum: Long.fromNumber(0),
              accountNum: Long.fromNumber(123),
            },
          },
          memo: '',
          transactionFee: Long.fromNumber(100000),
        },
      }).finish()

      signerRequestSpy.mockResolvedValueOnce({
        response: Uint8ArrayToBase64String(mockRecords),
      })

      const records = await signer.getAccountRecords()
      expect(Array.isArray(records)).toBe(true)
      expect(signerRequestSpy).toHaveBeenCalledWith({
        method: HederaJsonRpcMethod.SignAndExecuteQuery,
        params: expect.objectContaining({
          signerAccountId: 'hedera:testnet:' + signer.getAccountId().toString(),
        }),
      })
    })
  })
})
