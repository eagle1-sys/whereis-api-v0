
/**
 * @file github.ts
 * @description Provides a singleton class for interacting with GitHub Discussions API.
 *
 * This module implements a GitHub client that manages monthly update discussions in a GitHub repository.
 * It uses the GitHub GraphQL API to:
 * - Search for existing discussions by title
 * - Create new monthly discussion threads
 * - Add comments to discussions

 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
export class Github {

  // Singleton instance of the Github class.
  private static instance: Github | null = null;

  private readonly GITHUB_TOKEN: string;
  private readonly GITHUB_OWNER: string;
  private readonly GITHUB_REPO_ID: string;
  private readonly GITHUB_REPO_NAME: string;
  private readonly GITHUB_CATEGORY_ID: string;

  private constructor() {
    this.GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") || "";
    this.GITHUB_OWNER = Deno.env.get("GITHUB_OWNER") || "";
    this.GITHUB_REPO_ID = Deno.env.get("GITHUB_REPO_ID") || "";
    this.GITHUB_REPO_NAME = Deno.env.get("GITHUB_REPO_NAME") || "";
    this.GITHUB_CATEGORY_ID = Deno.env.get("GITHUB_CATEGORY_ID") || "";

    // Validate required environment variables
    if (!this.GITHUB_TOKEN || !this.GITHUB_OWNER || !this.GITHUB_REPO_ID || !this.GITHUB_REPO_NAME || !this.GITHUB_CATEGORY_ID  ) {
      throw new Error("Missing required environment variables: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO_ID, GITHUB_REPO_NAME or GITHUB_CATEGORY_ID");
    }
  }

  /**
   * Gets the singleton instance of the Github class.
   * 
   * This method implements the singleton pattern, ensuring only one instance
   * of the Github class exists throughout the application lifecycle. If an
   * instance doesn't exist, it creates one; otherwise, it returns the existing instance.
   * 
   * @returns {Github} The singleton instance of the Github class with initialized
   * GitHub API credentials and repository configuration.
   * 
   * @throws {Error} Throws an error if required environment variables are not set
   * (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO_ID, GITHUB_REPO_NAME or GITHUB_CATEGORY_ID).
   */
  public static getInstance(): Github {
    if (!Github.instance) {
      Github.instance = new Github();
    }
    return Github.instance;
  }
  
  /**
   * Adds a comment to the current month's discussion thread.
   * 
   * This method retrieves or creates a monthly discussion thread based on the current
   * month and year, then adds the provided comment to that discussion. If a discussion
   * for the current month doesn't exist, it will be automatically created before adding
   * the comment.
   * 
   * @param {string} comment - The comment text to be added to the monthly discussion thread.
   * The comment can include markdown formatting and will be posted as-is to the GitHub discussion.
   * 
   * @returns {Promise<void>} A promise that resolves when the comment has been successfully
   * added to the discussion thread.
   * 
   * @throws {Error} Throws an error if the GitHub API request fails during discussion
   * retrieval, creation, or comment addition.
   */
  async putComment(comment: string): Promise<void> {
    const title = this.getMonthlyTitle();

    let discussion = await this.getDiscussionByTitle(title);

    if (!discussion) {
      discussion = await this.createDiscussion(title);
    }

    await this.addComment(discussion.id, comment);
  }

  /**
   * Generates a standardized monthly discussion title based on the current date.
   * 
   * This method creates a title string in the format "YYYY-MM Monthly Update" using
   * the current year and month. The month is zero-padded to ensure a consistent
   * two-digit format (e.g., "01" for January, "12" for December).
   * 
   * @returns {string} A formatted string representing the monthly discussion title,
   * following the pattern "YYYY-MM Monthly Update" (e.g., "2025-01 Monthly Update").
   * 
   * @private
   */
  private getMonthlyTitle(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    return `${year}-${month} Monthly Update`;
  }

  /**
   * Searches for a GitHub discussion by its exact title.
   *
   * This method queries the GitHub GraphQL API to retrieve the most recent 50 discussions
   * from the configured repository, ordered by creation date (newest first). It then searches
   * through these discussions to find one with a title that exactly matches the provided title.
   *
   * @param {string} title - The exact title of the discussion to search for. The search is
   * case-sensitive and requires an exact match.
   *
   * @returns {Promise<{ id: string; number: number; url: string } | null>} A promise that
   * resolves to an object containing the discussion's GraphQL ID, issue number, and URL if
   * found, or null if no matching discussion exists. The returned object structure is:
   * - `id`: The GraphQL node ID of the discussion
   * - `number`: The discussion number (used in URLs and references)
   * - `url`: The full URL to the discussion on GitHub
   *
   * @throws {Error} Throws an error if the GitHub GraphQL API request fails or returns
   * a non-OK response status.
   */
  private async getDiscussionByTitle(
    title: string,
  ): Promise<{ id: string; number: number; url: string } | null> {
    const query = `
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        discussions(first: 50, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes {
            id
            number
            title
            url
          }
        }
      }
    }`;

    const variables = { owner: this.GITHUB_OWNER, repo: this.GITHUB_REPO_NAME };
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GraphQL search failed: ${err}`);
    }

    const responseJson = await res.json();

    // Check for GraphQL errors (auth, rate limit, etc.)
    if (responseJson.errors && Array.isArray(responseJson.errors) && responseJson.errors.length > 0) {
      const errorMessages = responseJson.errors.map((e: { message: string }) => e.message).join("; ");
      throw new Error(`GraphQL search returned errors: ${errorMessages}`);
    }

    // Validate data structure
    if (!responseJson.data) {
      throw new Error("GraphQL search returned no data (possible authentication or permission issue)");
    }

    if (!responseJson.data.repository) {
      throw new Error(`Repository not found or not accessible: ${this.GITHUB_OWNER}/${this.GITHUB_REPO_NAME}`);
    }

    if (!responseJson.data.repository.discussions) {
      throw new Error("Discussions data is missing from repository response");
    }

    const nodes = responseJson.data.repository.discussions.nodes || [];
    const discussion = nodes.find((d: { id: string; number: number; title: string; url: string }) => d.title === title);

    if (discussion) {
      return {
        id: discussion.id,
        number: discussion.number,
        url: discussion.url,
      };
    }

    return null;
  }

  /**
   * Creates a new discussion thread in the GitHub repository.
   *
   * This method uses the GitHub GraphQL API to create a new discussion with the specified
   * title in the configured repository and category. The discussion body is automatically
   * generated with a standard format including the title, description as a monthly update
   * thread, and the creation date.
   *
   * @param {string} title - The title for the new discussion thread. This will be used
   * both as the discussion title and as a heading in the discussion body.
   *
   * @returns {Promise<{ id: string; number: number; url: string }>} A promise that resolves
   * to an object containing the newly created discussion's details:
   * - `id`: The GraphQL node ID of the discussion
   * - `number`: The discussion number (used in URLs and references)
   * - `url`: The full URL to the discussion on GitHub
   *
   * @throws {Error} Throws an error if the GitHub GraphQL API request fails or returns
   * a non-OK response status.
   */
  private async createDiscussion(
    title: string,
  ): Promise<{ id: string; number: number; url: string }> {
    const mutation = `
    mutation($input: CreateDiscussionInput!) {
      createDiscussion(input: $input) {
        discussion {
          id
          number
          url
        }
      }
    }`;

    const variables = {
      input: {
        repositoryId: this.GITHUB_REPO_ID,
        title,
        body: `## ${title}\n\nMonthly update thread.\n\nCreated on ${
          new Date().toISOString().split("T")[0]
        }.`,
        categoryId: this.GITHUB_CATEGORY_ID,
      },
    };

    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Create failed: ${err}`);
    }

    const responseJson = await res.json();

    // Check for GraphQL errors
    if (responseJson.errors && Array.isArray(responseJson.errors) && responseJson.errors.length > 0) {
      const errorMessages = responseJson.errors.map((e: { message: string }) => e.message).join("; ");
      throw new Error(`Create discussion returned errors: ${errorMessages}`);
    }

    // Validate data structure
    if (!responseJson.data) {
      throw new Error(`Create discussion returned no data. Response: ${JSON.stringify(responseJson)}`);
    }

    if (!responseJson.data.createDiscussion) {
      throw new Error(`Create discussion mutation failed. Response: ${JSON.stringify(responseJson)}`);
    }

    if (!responseJson.data.createDiscussion.discussion) {
      throw new Error(`Discussion object missing from response. Response: ${JSON.stringify(responseJson)}`);
    }

    const discussion = responseJson.data.createDiscussion.discussion;
    return {
      id: discussion.id,
      number: discussion.number,
      url: discussion.url,
    };
  }

  /**
   * Adds a comment to an existing GitHub discussion thread.
   *
   * This method uses the GitHub GraphQL API to post a new comment to a specified
   * discussion. The comment is added using the discussion's GraphQL node ID and
   * can contain markdown-formatted text.
   *
   * @param {string} discussionId - The GraphQL node ID of the discussion to which
   * the comment will be added. This is the unique identifier returned when creating
   * or retrieving a discussion.
   * @param {string} body - The content of the comment to be posted. This can include
   * markdown formatting and will be rendered accordingly in the GitHub discussion.
   *
   * @returns {Promise<void>} A promise that resolves when the comment has been
   * successfully added to the discussion thread.
   *
   * @throws {Error} Throws an error if the GitHub GraphQL API request fails or
   * returns a non-OK response status.
   */
  private async addComment(discussionId: string, body: string): Promise<void> {
    const mutation = `
    mutation($input: AddDiscussionCommentInput!) {
      addDiscussionComment(input: $input) {
        comment {
          id
          url
        }
      }
    }`;

    const variables = {
      input: {
        discussionId,
        body,
      },
    };

    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Add comment failed: ${err}`);
    }

    const responseJson = await res.json();

    // Check for GraphQL errors
    if (responseJson.errors && Array.isArray(responseJson.errors) && responseJson.errors.length > 0) {
      const errorMessages = responseJson.errors.map((e: { message: string }) => e.message).join("; ");
      throw new Error(`Add comment returned errors: ${errorMessages}`);
    }

    // Validate data structure
    if (!responseJson.data) {
      throw new Error(`Add comment returned no data. Response: ${JSON.stringify(responseJson)}`);
    }

    if (!responseJson.data.addDiscussionComment) {
      throw new Error(`Add comment mutation failed. Response: ${JSON.stringify(responseJson)}`);
    }

    if (!responseJson.data.addDiscussionComment.comment) {
      throw new Error(`Comment object missing from response. Response: ${JSON.stringify(responseJson)}`);
    }

    const comment = responseJson.data.addDiscussionComment.comment;
    // Validate required fields
    if (!comment.id || !comment.url) {
      throw new Error(`Comment missing required fields. Response: ${JSON.stringify(comment)}`);
    }

  }
}