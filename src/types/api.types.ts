export interface ApiUser {
  username: string;
  avatar_url: string;
}

export interface ApiPagination {
  page: number;
  pages: number;
  per_page: number;
  items: number;
}

export interface ApiArtist {
  name: string;
  anv: string;
  role: string;
}

export interface ApiLabel {
  name: string;
  catno: string;
}

export interface ApiFormat {
  name: string;
  qty: string;
  descriptions: string[];
}

export interface ApiCollectionItem {
  instance_id: number;
  release_id: number;
  date_added: string;
  folder_id: number;
  basic_information: {
    title: string;
    artists: ApiArtist[];
    labels: ApiLabel[];
    genres: string[];
    styles: string[];
    formats: ApiFormat[];
    cover_image: string;
    thumb: string;
    year: number;
  };
}

export interface ApiCollectionResponse {
  items: ApiCollectionItem[];
  pagination: ApiPagination;
}

export interface ApiWantlistItem {
  release_id: number;
  date_added: string;
  basic_information: {
    title: string;
    artists: ApiArtist[];
    labels: ApiLabel[];
    genres: string[];
    styles: string[];
    formats: ApiFormat[];
    cover_image: string;
    thumb: string;
    year: number;
  };
}

export interface ApiWantlistResponse {
  items: ApiWantlistItem[];
  pagination: ApiPagination;
}

export interface ApiTrack {
  position: string;
  type_: string;
  title: string;
  duration: string;
  extraartists: ApiArtist[];
}

export interface ApiVideo {
  uri: string;
  title: string;
  embed: boolean;
}

export interface ApiReleaseDetail {
  id: number;
  title: string;
  artists: ApiArtist[];
  labels: ApiLabel[];
  formats: ApiFormat[];
  genres: string[];
  styles: string[];
  year: number;
  country: string;
  notes: string;
  cover_image: string;
  tracklist: ApiTrack[];
  videos: ApiVideo[];
  discogs_url: string;
}

export interface ApiSearchResult {
  id: number;
  title: string;
  year: string;
  label: string[];
  catno: string;
  genre: string[];
  style: string[];
  cover_image: string;
  thumb: string;
  format: string[];
  country: string;
  in_wantlist: boolean;
}

export interface ApiSearchResponse {
  results: ApiSearchResult[];
  pagination: ApiPagination;
}

export interface ApiCollectionValue {
  minimum: string;
  median: string;
  maximum: string;
  currency: string;
}
