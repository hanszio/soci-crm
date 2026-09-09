declare module "pdf-parse/lib/pdf-parse.js" {
  const parse: (data: Buffer) => Promise<{ text: string }>;
  export default parse;
}
