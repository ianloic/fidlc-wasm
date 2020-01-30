class Completer {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class Fidlc {
  constructor(instance) {
    this.instance = instance;
    this.compileCompleter = null;
  }

  // Functions called by the WASM module
  printMessage(addr, len) {
    console.log("FIDLC: " + window.fidlc.getString(addr, len));
  }
  jsonCompiled(addr, len) {
    if (this.compileCompleter) {
      const json = window.fidlc.getString(addr, len);
      this.compileCompleter.resolve(json);
    } else {
      console.error("unexpected jsonCompiled call");
    }
  }

  // Utility functions
  allocate(size) {
    const addr = this.instance.exports.allocate(size);
    return new Uint8Array(this.instance.exports.memory.buffer, addr, size);
  }
  deallocate(buffer) {
    this.instance.exports.deallocate(buffer.byteOffset);
  }
  peek(addr, size) {
    return new Uint8Array(this.instance.exports.memory.buffer, addr, size);
  }
  getString(addr, size) {
    return new TextDecoder().decode(this.peek(addr, size));
  }
  allocateString(value) {
    const encoded = new TextEncoder("utf-8").encode(value);
    const buffer = this.allocate(encoded.length);
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = encoded[i];
    }
    return buffer;
  }

  // Main entry-point
  async compile(source) {
    if (this.compileCompleter) {
      throw new Error("fidlc isn't reentrant");
    }
    this.compileCompleter = new Completer();
    const sourceBuffer = this.allocateString(source);
    const result = this.instance.exports.compile(
      sourceBuffer.byteOffset,
      sourceBuffer.byteLength
    );
    this.deallocate(sourceBuffer);
    if (result) {
      const json = await this.compileCompleter.promise;
      this.compileCompleter = null;
      return json;
    } else {
      this.compileCompleter = null;
      return null;
    }
  }
}

async function loadCompiler() {
  // The environment for the FIDLC wasm module
  const importObject = {
    env: {},
    wasi_unstable: {}
  };

  const unimplemented = name => () => console.error(`${name} not implemented`);

  // clang seems to think it needs these (apparently soft-flow related) functions
  for (f of ["__gttf2", "__lttf2", "__trunctfsf2", "__trunctfdf2"]) {
    importObject.env[f] = unimplemented(f);
  }
  // the libc wants these WASI functions
  for (f of ["fd_close", "fd_seek", "fd_write"]) {
    importObject.wasi_unstable[f] = unimplemented(f);
  }

  // dispatch calls off to the main wrapper object
  const wrapperHolder = {
    wrapper: null
  };
  importObject.env.printMessage = (addr, len) =>
    wrapperHolder.wrapper.printMessage(addr, len);
  importObject.env.jsonCompiled = (addr, len) =>
    wrapperHolder.wrapper.jsonCompiled(addr, len);

  const module = await WebAssembly.instantiateStreaming(
    fetch("build/fidlc.wasm"),
    importObject
  );
  fidlc = new Fidlc(module.instance);
  wrapperHolder.wrapper = fidlc;

  window.fidlc = fidlc;
  console.log("loaded");
}

loadCompiler().then(
  () => (document.getElementById("compile").disabled = false)
);

async function compile() {
  document.getElementById("json").value = await fidlc.compile(
    document.getElementById("fidl").value
  );
}
