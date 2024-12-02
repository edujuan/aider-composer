export interface DiffParams {
  // file path
  original: string;
  // modified content
  modified: {
    path: string;
    content: string;
  };
}
