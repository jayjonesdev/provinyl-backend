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

  type Callback = (err: Error | null, data: unknown) => void;

  class Client {
    constructor(auth?: ClientAuth);
    database(): Database;
    user(): UserResource;
    get(path: string, callback: Callback): void;
  }

  interface Database {
    search(options: Record<string, string | number>, callback: Callback): void;
    getRelease(releaseId: number, callback: Callback): void;
  }

  // client.user().collection() — disconnect/lib/collection.js
  interface CollectionResource {
    getReleases(
      username: string,
      folderId: number,
      params: Record<string, string | number>,
      callback: Callback,
    ): void;
    getReleases(username: string, folderId: number, callback: Callback): void;
    addRelease(username: string, folderId: number, releaseId: number, callback: Callback): void;
    removeRelease(
      username: string,
      folderId: number,
      releaseId: number,
      instanceId: number,
      callback: Callback,
    ): void;
  }

  // client.user().wantlist() — disconnect/lib/wantlist.js
  interface WantlistResource {
    getReleases(username: string, params: Record<string, string | number>, callback: Callback): void;
    getReleases(username: string, callback: Callback): void;
    addRelease(username: string, releaseId: number, callback: Callback): void;
    removeRelease(username: string, releaseId: number, callback: Callback): void;
  }

  // client.user() — disconnect/lib/user.js
  interface UserResource {
    collection(): CollectionResource;
    wantlist(): WantlistResource;
  }

  export { OAuth, Client };
}
