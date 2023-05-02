import { VenlyConnect, Wallet, AuthenticationOptions, Account, AuthenticationResult } from '@venly/connect'
import { VenlyProviderOptions } from './index';
import { REQUEST_TYPES } from './types';

export class VenlyController {

  public venlyConnect!: VenlyConnect;
  public options!: VenlyProviderOptions;
  private authResult: any;
  private lastWalletsFetch?: number;
  private wallets: Wallet[] = [];
  
  constructor(options: VenlyProviderOptions) {
    this.options = options;
    this.venlyConnect = new VenlyConnect(options.clientId, {
      environment: options.environment,
      windowMode: options.windowMode,
      bearerTokenProvider: options.bearerTokenProvider,
      useOverlayWithPopup: false
    });
  }

  resetWallets() {
    this.lastWalletsFetch = undefined;
    this.wallets = [];
  }

  async authenticate(authenticationOptions?: AuthenticationOptions): Promise<AuthenticationResult>  {
    if (!this.authResult || !this.authResult.isAuthenticated)
      this.authResult = await this.venlyConnect.flows.authenticate({
        ...authenticationOptions,
        forcePopup: true
      });
    return this.authResult;
  }

  async checkAuthenticated(): Promise<AuthenticationResult> {
    return this.authResult = await this.venlyConnect.checkAuthenticated();
  }

  async logout(): Promise<void>  {
    this.authResult = await this.venlyConnect.logout();
  }

  async getAccounts(): Promise<string[]> {
    if (!this.authResult || !this.authResult.isAuthenticated)
      this.authResult = await this.startGetAccountFlow(this.options.authenticationOptions);
    else
      await this.refreshWallets();

    return this.wallets.map((wallet) => wallet.address);
  }

  async processTransaction(params: any, req: any) {
    const signer = this.venlyConnect.createSigner();
    const transactionData = {
      walletId: this.getWalletIdFrom(params.from),
      type: REQUEST_TYPES[this.options.secretType!].transaction,
      ...params.to && { to: params.to },
      ...params.data && { data: params.data },
      ...params.value && { value: BigInt(params.value).toString() },
      ...params.gas && { gas: BigInt(params.gas).toString() },
      ...params.gasPrice && { gasPrice: BigInt(params.gasPrice).toString() },
      ...params.nonce && { nonce: BigInt(params.nonce).toString() }
    };
    const res = await signer.executeNativeTransaction(transactionData);
    if (res.status === 'SUCCESS')
      return res.result.transactionHash;
    else
      throw new Error(res.errors?.join(', '));
  }

  async processSignTransaction(params: any, req: any): Promise<string> {
    const signer = this.venlyConnect.createSigner();
    const transactionData = {
      walletId: this.getWalletIdFrom(params.from),
      type: REQUEST_TYPES[this.options.secretType!].signature,
      ...params.to && { to: params.to },
      ...params.data && { data: params.data },
      ...params.value && { value: BigInt(params.value).toString() },
      ...params.gas && { gas: BigInt(params.gas).toString() },
      ...params.gasPrice && { gasPrice: BigInt(params.gasPrice).toString() },
      ...params.nonce && { nonce: BigInt(params.nonce).toString() }
    };
    const res = await signer.sign(transactionData);
    if (res.status === 'SUCCESS')
      return res.result.signedTransaction;
    else
      throw new Error(res.errors?.join(', '));
  }

  async processEthSignMessage(params: any, req: any) {
    const signer = this.venlyConnect.createSigner();
    const res = await signer.signMessage({
      walletId: this.getWalletIdFrom(params.from),
      secretType: this.options.secretType!,
      data: params.data
    });
    if (res.status === 'SUCCESS')
      return res.result.signature;
    else
      throw new Error(res.errors?.join(', '));
  }

  async processTypedMessage(params: any, req: any, version: any): Promise<string> {
    const signer = this.venlyConnect.createSigner();
    const res = await signer.signEip712({
      walletId: this.getWalletIdFrom(params.from),
      secretType: this.options.secretType!,
      data: JSON.parse(params.data)
    });
    if (res.status === 'SUCCESS')
        return res.result.signature;
    else
      throw new Error(res.errors?.join(', '));
  }

  async processPersonalMessage(params: any, req: any) {
    const signer = this.venlyConnect.createSigner();
    const res = await signer.signMessage({
      walletId: this.getWalletIdFrom(params.from),
      secretType: this.options.secretType!,
      data: params.data
    });
    if (res.status === 'SUCCESS')
      return res.result.signature;
    else
      throw new Error(res.errors?.join(', '));
  }

  async getTransactionByHash(hash: string) {
    const res: any = await this.venlyConnect.api.getTransactionStatus(hash, this.options.secretType!);
    res.value = BigInt(res.rawValue).toString();
    if (!res.data) res.data = '0x';
    const {rawValue, ...transaction} = res;
    return transaction;
  }

  async getPendingTransactions() {
    const res: any = await this.venlyConnect.api.getPendingTransactions();
    return res.map((tx: any) => {
      const {rawValue, type, ...transaction} = tx.transactionRequest;
      transaction.value = BigInt(transaction.value).toString();
      return transaction;
    });
  }

  async getPendingNonce(nonce: string) {
    const res = await this.venlyConnect.api.getPendingTransactions();
    const pendingNonce = Number(nonce) + res.length;
    return '0x' + pendingNonce.toString(16);
  }

  private async refreshWallets() {
    if (!this.lastWalletsFetch || (Date.now() - this.lastWalletsFetch) > 5000) {
      let wallets = await this.venlyConnect.api.getWallets({ secretType: this.options.secretType, includeBalance: false });
      if (!wallets || wallets.length < 1) {
        let account = await this.venlyConnect.flows.getAccount(this.options.secretType!, this.options.authenticationOptions);
        wallets = account.wallets;
      }
      this.wallets = wallets;
    }
    this.lastWalletsFetch = Date.now();
    return this.wallets;
  }

  public async startGetAccountFlow(authenticationOptions?: AuthenticationOptions): Promise<Account | {}> {
    if (authenticationOptions) {
      this.options.authenticationOptions = authenticationOptions;
    }
    return this.venlyConnect.flows.getAccount(this.options.secretType!, this.options.authenticationOptions)
      .then(async (account: Account) => {
        return await new Promise((resolve, reject) => {
          if (!account.isAuthenticated)
            reject('not-authenticated');
          else if (account.wallets && account.wallets.length <= 0)
            reject('no-wallet-linked');
          else {
            this.wallets = account.wallets;
            this.lastWalletsFetch = Date.now();
            resolve(account);
          }
        });
      });
  }

  private getWalletIdFrom(address: string): string {
    let foundWallet = this.wallets.find((wallet) => {
      return wallet.address?.toLowerCase() === address?.toLowerCase();
    });
    return (foundWallet?.id) || '';
  }

}