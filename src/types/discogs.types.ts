export interface DiscogsArtist {
  name: string;
  anv: string;
  join: string;
  role: string;
  tracks: string;
  id: number;
  resource_url: string;
}

export interface DiscogsLabel {
  name: string;
  catno: string;
  entity_type: string;
  entity_type_name: string;
  id: number;
  resource_url: string;
}

export interface DiscogsFormat {
  name: string;
  qty: string;
  descriptions: string[];
}

export interface DiscogsImage {
  type: string;
  uri: string;
  resource_url: string;
  uri150: string;
  width: number;
  height: number;
}

export interface DiscogsTrack {
  position: string;
  type_: string;
  title: string;
  duration: string;
  extraartists?: DiscogsArtist[];
}

export interface DiscogsVideo {
  uri: string;
  title: string;
  description: string;
  duration: number;
  embed: boolean;
}

export interface DiscogsBasicInformation {
  id: number;
  title: string;
  year: number;
  resource_url: string;
  thumb: string;
  cover_image: string;
  formats: DiscogsFormat[];
  labels: DiscogsLabel[];
  artists: DiscogsArtist[];
  genres: string[];
  styles: string[];
}

export interface DiscogsCollectionRelease {
  id: number;
  instance_id: number;
  date_added: string;
  folder_id: number;
  rating: number;
  basic_information: DiscogsBasicInformation;
}

export interface DiscogsCollectionResponse {
  releases: DiscogsCollectionRelease[];
  pagination: DiscogsPagination;
}

export interface DiscogsPagination {
  page: number;
  pages: number;
  per_page: number;
  items: number;
  urls: {
    first?: string;
    last?: string;
    prev?: string;
    next?: string;
  };
}

export interface DiscogsWantlistItem {
  id: number;
  date_added: string;
  rating: number;
  notes: string;
  basic_information: DiscogsBasicInformation;
}

export interface DiscogsWantlistResponse {
  wants: DiscogsWantlistItem[];
  pagination: DiscogsPagination;
}

export interface DiscogsRelease {
  id: number;
  title: string;
  artists: DiscogsArtist[];
  labels: DiscogsLabel[];
  formats: DiscogsFormat[];
  genres: string[];
  styles: string[];
  year: number;
  country: string;
  notes: string;
  images: DiscogsImage[];
  tracklist: DiscogsTrack[];
  videos: DiscogsVideo[];
  uri: string;
}

export interface DiscogsSearchResult {
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
  resource_url: string;
  type: string;
}

export interface DiscogsSearchResponse {
  results: DiscogsSearchResult[];
  pagination: DiscogsPagination;
}

export interface DiscogsCollectionValue {
  minimum: string;
  median: string;
  maximum: string;
}
