declare module "*?raw" {
  const text: string;
  export default text;
}

declare module "*?worker" {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}
