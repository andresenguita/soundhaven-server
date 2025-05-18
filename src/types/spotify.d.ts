// Tipos para respuestas de la API de Spotify

export interface SpotifyUser {
  id: string;
  display_name: string;
  email?: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
}

export interface SpotifyPlaylistsResponse {
  items: SpotifyPlaylist[];
  next: string | null;
}

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface SpotifyErrorResponse {
  error: string;
  error_description?: string;
}
