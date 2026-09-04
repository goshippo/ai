// A loader hook that fails the process if loading dist/core.js pulls in anything from
// node_modules. This is the mechanical form of the "dependency-free core" claim in the README.
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  if (resolved.url.includes('/node_modules/')) {
    console.error(`core loaded a third-party module: ${resolved.url}`);
    process.exit(1);
  }
  return resolved;
}
