// Lets TypeScript understand CSS imports (Vite handles the actual loading).
// No imports here: that keeps these declarations global.

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

declare module '*.css'
