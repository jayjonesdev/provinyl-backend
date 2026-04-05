declare module 'disconnect/lib/oauth' {
  interface OAuthAuth {
    method?: string;
    level?: number;
    consumerKey?: string;
    consumerSecret?: string;
    token?: string;
    tokenSecret?: string;
    authorizeUrl?: string;
    family?: string;
  }

  type OAuthCallback = (err: Error | null, auth: OAuthAuth) => void;

  class DiscogsOAuth {
    constructor(auth?: Partial<OAuthAuth>);
    getRequestToken(
      consumerKey: string,
      consumerSecret: string,
      callbackUrl: string,
      callback: OAuthCallback,
    ): this;
    getAccessToken(verifier: string, callback: OAuthCallback): this;
    export(): OAuthAuth;
  }

  export = DiscogsOAuth;
}

declare module 'disconnect' {
  interface OAuthAuth {
    method: string;
    level: number;
    consumerKey?: string;
    consumerSecret?: string;
    token?: string;
    tokenSecret?: string;
    authorizeUrl?: string;
    family?: string;
  }

  type OAuthCallback = (err: Error | null, auth: OAuthAuth) => void;

  class OAuth {
    constructor(auth?: Partial<OAuthAuth>);
    getRequestToken(
      consumerKey: string,
      consumerSecret: string,
      callbackUrl: string,
      callback: OAuthCallback,
    ): this;
    getAccessToken(verifier: string, callback: OAuthCallback): this;
    export(): OAuthAuth;
  }

  interface ClientAuth {
    method: 'oauth' | 'discogs' | 'token';
    level?: number;
    consumerKey?: string;
    consumerSecret?: string;
    token?: string;
    tokenSecret?: string;
  }

  class Client {
    constructor(auth?: ClientAuth);
    database(): Database;
    user(): UserResource;
  }

  interface Database {
    search(
      options: Record<string, string | number>,
      callback: (err: Error | null, data: unknown) => void,
    ): void;
    getRelease(
      releaseId: number,
      callback: (err: Error | null, data: unknown) => void,
    ): void;
  }

  interface UserResource {
    getCollection(
      username: string,
      folderId: number,
      options: Record<string, string | number>,
      callback: (err: Error | null, data: unknown) => void,
    ): void;
    getWantlist(
      username: string,
      options: Record<string, string | number>,
      callback: (err: Error | null, data: unknown) => void,
    ): void;
    getCollectionValue(
      username: string,
      callback: (err: Error | null, data: unknown) => void,
    ): void;
    addToCollection(
      username: string,
      folderId: number,
      releaseId: number,
      callback: (err: Error | null, data: unknown) => void,
    ): void;
    removeFromCollection(
      username: string,
      folderId: number,
      releaseId: number,
      instanceId: number,
      callback: (err: Error | null, data: unknown) => void,
    ): void;
    addToWantlist(
      username: string,
      releaseId: number,
      callback: (err: Error | null, data: unknown) => void,
    ): void;
    removeFromWantlist(
      username: string,
      releaseId: number,
      callback: (err: Error | null, data: unknown) => void,
    ): void;
  }

  export { OAuth, Client };
}
