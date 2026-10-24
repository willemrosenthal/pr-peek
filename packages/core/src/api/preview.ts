import { z } from "zod";
import type { PrReview } from "../pr-snapshot";

export const previewQuery = z.object({
  // The item the preview was opened from. Its comment is the one marked.
  item: z.string().min(1).max(100).optional(),
});
export type PreviewQuery = z.infer<typeof previewQuery>;

// One comment or review in a preview. Dates are ISO strings.
export interface PreviewCommentDto {
  id: string;
  author: string;
  // GitHub's HTML for its text. Empty for an approval with no text.
  bodyHtml: string;
  createdAt: string;
  // Real time since it was posted, like "3h".
  age: string;
  // "path:line" for a comment on a file. Null elsewhere.
  where: string | null;
  // What a review did. Null for comments.
  reviewState: PrReview["state"] | null;
}

// More about one PR than the list shows, fetched from GitHub when the preview opens.
export interface PrPreviewResponse {
  // GitHub's HTML for the description. Empty when there is none.
  bodyHtml: string;
  // Real time since the PR was opened, like "2d".
  openedAge: string;
  failingChecks: string[];
  // The conversation, oldest first.
  comments: PreviewCommentDto[];
  // The item's comment or review. Null when it isn't one of them, like for a review
  // request.
  focusId: string | null;
}
