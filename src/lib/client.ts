/**
 * A tiny typed client for the Novel Illustration Studio REST API.
 *
 * The MCP server is a thin adapter over HTTP: it never touches the storage
 * layer directly, so an agent that talks to the MCP server and a human that
 * talks to the website are always looking at the same state.
 */

const DEFAULT_BASE = process.env.NOVEL_ILL_API_URL ?? "http://localhost:3111";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class StudioClient {
  constructor(private readonly baseUrl: string = DEFAULT_BASE) {}

  private url(pathname: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${pathname}`;
  }

  async request<T>(
    pathname: string,
    init: RequestInit = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url(pathname), {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body && !(init.body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw new ApiError(
        `Cannot reach the Novel Illustration Studio API at ${this.baseUrl}. ` +
          `Start it with "npm run dev" or point NOVEL_ILL_API_URL at the deployed URL. ` +
          `(${error instanceof Error ? error.message : String(error)})`,
        0,
      );
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const message =
        (payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : `HTTP ${response.status}`) ?? `HTTP ${response.status}`;
      throw new ApiError(message, response.status, payload);
    }
    return payload as T;
  }

  get<T>(pathname: string): Promise<T> {
    return this.request<T>(pathname);
  }

  post<T>(pathname: string, body: unknown): Promise<T> {
    return this.request<T>(pathname, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  put<T>(pathname: string, body: unknown): Promise<T> {
    return this.request<T>(pathname, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  delete<T>(pathname: string): Promise<T> {
    return this.request<T>(pathname, { method: "DELETE" });
  }

  /** Upload a file as multipart/form-data. */
  async upload<T>(
    pathname: string,
    filename: string,
    bytes: Uint8Array,
    title?: string,
  ): Promise<T> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes as unknown as BlobPart], {
        type: "application/octet-stream",
      }),
      filename,
    );
    if (title) form.append("title", title);
    return this.request<T>(pathname, { method: "POST", body: form });
  }
}
