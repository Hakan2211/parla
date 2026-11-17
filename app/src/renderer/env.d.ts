/// <reference types="vite/client" />

declare module '*.css'
declare module '*.glsl' {
  const src: string
  export default src
}
