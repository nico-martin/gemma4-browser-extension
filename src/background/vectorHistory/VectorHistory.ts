import { type IDBPDatabase, openDB } from "idb";

import { WebMCPTool } from "../agent/webMcp.tsx";
import type FeatureExtractor from "../utils/FeatureExtractor.ts";

interface VectorHistoryEntry {
  id?: number;
  title: string;
  description: string;
  url: string;
  time: number;
  titleVector: number[];
  descriptionVector: number[];
  urlVector: number[];
}

interface FindEntryParams {
  query: string;
  from?: number;
  to?: number;
  limit?: number;
  minSimilarity?: number;
}

interface SearchResult extends VectorHistoryEntry {
  similarity: number;
}

interface VectorHistoryDB {
  entries: {
    key: number;
    value: VectorHistoryEntry;
    indexes: { time: number };
  };
}

export default class VectorHistory {
  private dbName = "VectorHistoryDB";
  private storeName = "entries";
  private dbPromise: Promise<IDBPDatabase<VectorHistoryDB>>;
  private featureExtractor: FeatureExtractor = null;

  constructor(featureExtractor: FeatureExtractor) {
    this.featureExtractor = featureExtractor;
    this.dbPromise = this.initDB();
  }

  private async initDB(): Promise<IDBPDatabase<VectorHistoryDB>> {
    return openDB<VectorHistoryDB>(this.dbName, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore("entries", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("time", "time", { unique: false });
        }
      },
    });
  }

  private parseISO8601(isoString: string): number | null {
    try {
      const timestamp = new Date(isoString).getTime();
      return isNaN(timestamp) ? null : timestamp;
    } catch {
      return null;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have same dimension");
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  public async addEntry(
    title: string,
    description: string,
    url: string
  ): Promise<number> {
    const db = await this.dbPromise;
    const [titleVector, descriptionVector, urlVector] =
      await this.featureExtractor.extractFeatures([title, description, url]);

    const entry: VectorHistoryEntry = {
      title,
      description,
      url,
      time: Date.now(),
      titleVector,
      descriptionVector,
      urlVector,
    };

    const id = await db.add(this.storeName, entry);
    return id as number;
  }

  public async findEntry(params: FindEntryParams): Promise<SearchResult[]> {
    const db = await this.dbPromise;
    const { query, from, to, limit = 10, minSimilarity = 0 } = params;
    const [queryVector] = await this.featureExtractor.extractFeatures([query]);

    const results: SearchResult[] = [];
    const tx = db.transaction(this.storeName, "readonly");

    // Use time index if from/to specified
    let cursor;
    if (from !== undefined || to !== undefined) {
      const range = this.getIDBKeyRange(from, to);
      cursor = await tx.store.index("time").openCursor(range);
    } else {
      cursor = await tx.store.openCursor();
    }

    while (cursor) {
      const entry = cursor.value;

      const titleSimilarity = this.cosineSimilarity(
        queryVector,
        entry.titleVector
      );
      const descSimilarity = this.cosineSimilarity(
        queryVector,
        entry.descriptionVector
      );

      // Handle old entries without urlVector
      let urlSimilarity = 0;
      if (entry.urlVector && entry.urlVector.length > 0) {
        urlSimilarity = this.cosineSimilarity(queryVector, entry.urlVector);
      }

      // Use max similarity across title, description, and URL
      const similarity = Math.max(
        titleSimilarity,
        descSimilarity,
        urlSimilarity
      );

      if (similarity >= minSimilarity) {
        results.push({
          ...entry,
          similarity,
        });
      }

      cursor = await cursor.continue();
    }

    await tx.done;

    // Sort by similarity and apply limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  private getIDBKeyRange(from?: number, to?: number): IDBKeyRange | undefined {
    if (from !== undefined && to !== undefined) {
      return IDBKeyRange.bound(from, to);
    } else if (from !== undefined) {
      return IDBKeyRange.lowerBound(from);
    } else if (to !== undefined) {
      return IDBKeyRange.upperBound(to);
    }
    return undefined;
  }

  public async getAllEntries(): Promise<VectorHistoryEntry[]> {
    const db = await this.dbPromise;
    return await db.getAll(this.storeName);
  }

  public async clearAll(): Promise<void> {
    const db = await this.dbPromise;
    await db.clear(this.storeName);
  }

  public async deleteEntry(id: number): Promise<void> {
    const db = await this.dbPromise;
    await db.delete(this.storeName, id);
  }

  public get findHistoryTool(): WebMCPTool {
    const currentDateTime = new Date().toISOString();

    return {
      name: "find_history",
      description: `Search through browsing history using semantic search. Returns entries that are semantically similar to the query, sorted by relevance. ALWAYS use this tool when a user asks about pages they visited in the past, wants to find a specific website or article they saw before, asks "do you know about...", or requests information from earlier browsing sessions.

Current date and time: ${currentDateTime}

Use ISO 8601 format for time filtering if the request contains a reference to a time range:
- Format: YYYY-MM-DDTHH:mm:ss.sssZ (e.g., "2024-11-19T10:30:00Z")
- 'from': Start of time range (inclusive)
- 'to': End of time range (inclusive)
- Both are optional - omit for no time filtering
- You can specify only 'from' to get everything after that time
- You can specify only 'to' to get everything before that time`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The search query to find semantically similar entries",
          },
          from: {
            type: "string",
            description:
              'Start time in ISO 8601 format (e.g., "2024-11-19T10:30:00Z"). Optional.',
          },
          to: {
            type: "string",
            description:
              'End time in ISO 8601 format (e.g., "2024-11-19T15:30:00Z"). Optional.',
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return (default: 10)",
            default: 10,
          },
          minSimilarity: {
            type: "number",
            description:
              "Minimum similarity score threshold 0-1 (default: 0.3)",
            default: 0.3,
          },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = args.query as string;
        const fromISO = args.from as string | undefined;
        const toISO = args.to as string | undefined;
        const limit = (args.limit as number) || 10;
        const minSimilarity = (args.minSimilarity as number) || 0.3;

        if (!query || typeof query !== "string") {
          return `Error: query parameter must be a non-empty string. Received: ${JSON.stringify(args)}`;
        }

        let from: number | undefined;
        let to: number | undefined;

        if (fromISO) {
          const parsed = this.parseISO8601(fromISO);
          if (parsed === null) {
            return `Error: Invalid 'from' datetime format. Expected ISO 8601 (e.g., "2024-11-19T10:30:00Z"). Received: "${fromISO}"`;
          }
          from = parsed;
        }

        if (toISO) {
          const parsed = this.parseISO8601(toISO);
          if (parsed === null) {
            return `Error: Invalid 'to' datetime format. Expected ISO 8601 (e.g., "2024-11-19T15:30:00Z"). Received: "${toISO}"`;
          }
          to = parsed;
        }

        try {
          const results = await this.findEntry({
            query,
            limit,
            minSimilarity,
            from,
            to,
          });

          if (results.length === 0) {
            return `No history entries found for query: "${query}" with similarity >= ${minSimilarity}`;
          }

          const formattedResults = results.map((result) => ({
            title: result.title,
            description: result.description,
            url: result.url,
            similarity: result.similarity.toFixed(3),
            time: new Date(result.time).toISOString(),
            //id: result.id,
          }));

          return JSON.stringify(formattedResults, null, 2);
        } catch (error) {
          return `Error searching history: ${error.toString()}`;
        }
      },
    };
  }
}
