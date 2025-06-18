use libc::{c_char, c_double, c_int};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
};
use napi::JsString;
use napi_derive::napi;
use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::sync::{Mutex, OnceLock};

// -------- FFI declarations to Swift dylib --------
#[link(name = "appleai")]
extern "C" {
    fn apple_ai_init() -> bool;
    fn apple_ai_check_availability() -> c_int;
    fn apple_ai_get_availability_reason() -> *mut c_char;

    fn apple_ai_get_supported_languages_count() -> c_int;
    fn apple_ai_get_supported_language(index: c_int) -> *mut c_char;

    fn apple_ai_generate_response(
        prompt: *const c_char,
        temperature: c_double,
        max_tokens: c_int,
    ) -> *mut c_char;

    fn apple_ai_generate_response_with_history(
        messages_json: *const c_char,
        temperature: c_double,
        max_tokens: c_int,
    ) -> *mut c_char;

    fn apple_ai_generate_response_stream(
        prompt: *const c_char,
        temperature: c_double,
        max_tokens: c_int,
        on_chunk: extern "C" fn(*const c_char),
    );

    fn apple_ai_generate_response_structured(
        prompt: *const c_char,
        schema_json: *const c_char,
        temperature: c_double,
        max_tokens: c_int,
    ) -> *mut c_char;

    // Tool callback registration and tool-based generation
    fn apple_ai_register_tool_callback(
        cb: Option<extern "C" fn(u64, *const c_char) -> *mut c_char>,
    );
    fn apple_ai_tool_result_callback(tool_id: u64, result_json: *const c_char);

    fn apple_ai_generate_response_with_tools(
        messages_json: *const c_char,
        tools_json: *const c_char,
        temperature: c_double,
        max_tokens: c_int,
    ) -> *mut c_char;

    fn apple_ai_generate_response_with_tools_stream(
        messages_json: *const c_char,
        tools_json: *const c_char,
        temperature: c_double,
        max_tokens: c_int,
        on_chunk: extern "C" fn(*const c_char),
    );
}

// --------------------------------------------------

/// Lazily ensure the Swift library is initialized exactly once.
fn ensure_initialized() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        if !apple_ai_init() {
            panic!("Failed to initialize Apple AI native library");
        }
    });
}

#[napi(object)]
pub struct ModelAvailability {
    pub available: bool,
    pub reason: String,
}

#[inline(always)]
fn take_c_string(ptr: *mut c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe {
        let s = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        libc::free(ptr as *mut _);
        s
    }
}

#[napi]
pub fn check_availability() -> napi::Result<ModelAvailability> {
    ensure_initialized();
    unsafe {
        let status = apple_ai_check_availability();
        if status == 1 {
            Ok(ModelAvailability {
                available: true,
                reason: "Available".to_string(),
            })
        } else {
            let reason_ptr = apple_ai_get_availability_reason();
            let reason = take_c_string(reason_ptr);
            Ok(ModelAvailability {
                available: false,
                reason,
            })
        }
    }
}

#[napi]
pub fn get_supported_languages() -> napi::Result<Vec<String>> {
    ensure_initialized();
    unsafe {
        let count = apple_ai_get_supported_languages_count();
        let mut langs = Vec::with_capacity(count as usize);
        for i in 0..count {
            let lang_ptr = apple_ai_get_supported_language(i);
            if !lang_ptr.is_null() {
                let s = take_c_string(lang_ptr);
                langs.push(s);
            }
        }
        Ok(langs)
    }
}

// ---------------- Async generation tasks ----------------

pub struct GenerateTask {
    pub prompt: String,
    pub temperature: f64,
    pub max_tokens: i32,
}

impl napi::Task for GenerateTask {
    type Output = String;
    type JsValue = JsString;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        ensure_initialized();
        let c_prompt = CString::new(self.prompt.clone())
            .map_err(|_| napi::Error::from_reason("Prompt contained null byte".to_string()))?;
        unsafe {
            let result_ptr = apple_ai_generate_response(
                c_prompt.as_ptr(),
                self.temperature as c_double,
                self.max_tokens as c_int,
            );
            if result_ptr.is_null() {
                return Err(napi::Error::from_reason(
                    "Generation returned null".to_string(),
                ));
            }
            Ok(take_c_string(result_ptr))
        }
    }

    fn resolve(&mut self, env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        env.create_string(&output)
    }
}

#[napi]
pub fn generate_response(
    prompt: String,
    #[napi(ts_arg_type = "number | undefined")] temperature: Option<f64>,
    #[napi(ts_arg_type = "number | undefined")] max_tokens: Option<i32>,
) -> napi::Result<AsyncTask<GenerateTask>> {
    let task = GenerateTask {
        prompt,
        temperature: temperature.unwrap_or(0.0),
        max_tokens: max_tokens.unwrap_or(0),
    };
    Ok(AsyncTask::new(task))
}

// Task for history
pub struct GenerateHistoryTask {
    pub messages_json: String,
    pub temperature: f64,
    pub max_tokens: i32,
}

impl napi::Task for GenerateHistoryTask {
    type Output = String;
    type JsValue = JsString;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        ensure_initialized();
        let c_json = CString::new(self.messages_json.clone())
            .map_err(|_| napi::Error::from_reason("JSON contained null byte".to_string()))?;
        unsafe {
            let result_ptr = apple_ai_generate_response_with_history(
                c_json.as_ptr(),
                self.temperature as c_double,
                self.max_tokens as c_int,
            );
            if result_ptr.is_null() {
                return Err(napi::Error::from_reason(
                    "Generation returned null".to_string(),
                ));
            }
            Ok(take_c_string(result_ptr))
        }
    }

    fn resolve(&mut self, env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        env.create_string(&output)
    }
}

#[napi]
pub fn generate_response_with_history(
    messages_json: String,
    #[napi(ts_arg_type = "number | undefined")] temperature: Option<f64>,
    #[napi(ts_arg_type = "number | undefined")] max_tokens: Option<i32>,
) -> napi::Result<AsyncTask<GenerateHistoryTask>> {
    let task = GenerateHistoryTask {
        messages_json,
        temperature: temperature.unwrap_or(0.0),
        max_tokens: max_tokens.unwrap_or(0),
    };
    Ok(AsyncTask::new(task))
}

// Safe global stream state ---------------------------------------------------

struct StreamState {
    tsfn: ThreadsafeFunction<String, ErrorStrategy::CalleeHandled>,
    _prompt: CString, // keeps the CString alive for the duration of the stream
}

static STREAM_STATE: OnceLock<Mutex<Option<StreamState>>> = OnceLock::new();

#[inline(always)]
fn stream_state() -> &'static Mutex<Option<StreamState>> {
    STREAM_STATE.get_or_init(|| Mutex::new(None))
}

const ERROR_SENTINEL: u8 = 0x02;

extern "C" fn chunk_callback(ptr: *const c_char) {
    // get mutex
    let mutex = stream_state();
    let mut guard = mutex.lock().unwrap();

    if let Some(state) = guard.as_mut() {
        if ptr.is_null() {
            // End of stream
            let _ = state
                .tsfn
                .call(Ok("".to_string()), ThreadsafeFunctionCallMode::NonBlocking);
            let _ = state.tsfn.clone().abort();
            *guard = None;
            return;
        }

        // Take ownership and free C string once here
        let slice_owned = take_c_string(ptr as *mut c_char);
        if slice_owned.is_empty() {
            return;
        }

        let bytes = slice_owned.as_bytes();
        if !bytes.is_empty() && bytes[0] == ERROR_SENTINEL {
            let msg = String::from_utf8_lossy(&bytes[1..]).into_owned();
            let _ = state.tsfn.call(
                Err(napi::Error::from_reason(msg)),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
            return;
        }

        let _ = state
            .tsfn
            .call(Ok(slice_owned), ThreadsafeFunctionCallMode::NonBlocking);
    }
}

#[napi]
pub fn generate_response_stream(
    prompt: String,
    #[napi(ts_arg_type = "number | undefined")] temperature: Option<f64>,
    #[napi(ts_arg_type = "number | undefined")] max_tokens: Option<i32>,
    callback: JsFunction,
) -> napi::Result<()> {
    let ts_fn: ThreadsafeFunction<String, ErrorStrategy::CalleeHandled> = callback
        .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<String>| {
            let env = ctx.env;
            let js_string = env.create_string(&ctx.value)?;
            Ok(vec![js_string]) // value will be passed as second arg, error injected automatically
        })?;

    // Prepare stream state safely
    let prompt_cstring = CString::new(prompt)?;
    {
        let mut guard = stream_state().lock().unwrap();
        *guard = Some(StreamState {
            tsfn: ts_fn,
            _prompt: prompt_cstring.clone(),
        });
    }

    // invoke Swift stream (pointer valid due to prompt_cstring clone in state)
    unsafe {
        apple_ai_generate_response_stream(
            prompt_cstring.as_ptr(),
            temperature.unwrap_or(0.0),
            max_tokens.unwrap_or(0),
            chunk_callback,
        );
    }
    Ok(())
}

// ---------------- Structured generation task ----------------

pub struct GenerateStructuredTask {
    pub prompt: String,
    pub schema_json: String,
    pub temperature: f64,
    pub max_tokens: i32,
}

impl napi::Task for GenerateStructuredTask {
    type Output = String;
    type JsValue = JsString;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        ensure_initialized();
        let c_prompt = CString::new(self.prompt.clone())
            .map_err(|_| napi::Error::from_reason("Prompt contained null byte".to_string()))?;
        let c_schema = CString::new(self.schema_json.clone())
            .map_err(|_| napi::Error::from_reason("Schema contained null byte".to_string()))?;
        unsafe {
            let result_ptr = apple_ai_generate_response_structured(
                c_prompt.as_ptr(),
                c_schema.as_ptr(),
                self.temperature as c_double,
                self.max_tokens as c_int,
            );
            if result_ptr.is_null() {
                return Err(napi::Error::from_reason(
                    "Generation returned null".to_string(),
                ));
            }
            Ok(take_c_string(result_ptr))
        }
    }

    fn resolve(&mut self, env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        env.create_string(&output)
    }
}

#[napi]
pub fn generate_response_structured(
    prompt: String,
    schema_json: String,
    #[napi(ts_arg_type = "number | undefined")] temperature: Option<f64>,
    #[napi(ts_arg_type = "number | undefined")] max_tokens: Option<i32>,
) -> napi::Result<AsyncTask<GenerateStructuredTask>> {
    let task = GenerateStructuredTask {
        prompt,
        schema_json,
        temperature: temperature.unwrap_or(0.0),
        max_tokens: max_tokens.unwrap_or(0),
    };
    Ok(AsyncTask::new(task))
}

// ---------- Global tool handler state ----------

// Async tool dispatcher - like streaming
static TOOL_CALLBACK: OnceLock<
    Mutex<Option<ThreadsafeFunction<(u64, String), ErrorStrategy::CalleeHandled>>>,
> = OnceLock::new();
static TOOL_RESULTS: OnceLock<Mutex<HashMap<u64, std::sync::mpsc::Sender<String>>>> =
    OnceLock::new();

fn tool_callback(
) -> &'static Mutex<Option<ThreadsafeFunction<(u64, String), ErrorStrategy::CalleeHandled>>> {
    TOOL_CALLBACK.get_or_init(|| Mutex::new(None))
}

fn tool_results() -> &'static Mutex<HashMap<u64, std::sync::mpsc::Sender<String>>> {
    TOOL_RESULTS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[napi]
pub fn set_tool_callback(callback: JsFunction) -> napi::Result<()> {
    // Replace any existing callback atomically
    let tsfn: ThreadsafeFunction<(u64, String), ErrorStrategy::CalleeHandled> = callback
        .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<(u64, String)>| {
            let env = ctx.env;
            let (tool_id, args_json) = ctx.value;
            let js_tool_id = env.create_uint32(tool_id as u32)?;
            let js_args = env.create_string(&args_json)?;
            Ok(vec![js_tool_id.into_unknown(), js_args.into_unknown()])
        })?;

    let mut guard = tool_callback().lock().unwrap();
    if let Some(old) = guard.take() {
        let _ = old.abort();
    }
    *guard = Some(tsfn);
    Ok(())
}

#[napi]
pub fn clear_tool_callback() -> napi::Result<()> {
    let mut guard = tool_callback().lock().unwrap();
    if let Some(tsfn) = guard.take() {
        let _ = tsfn.abort();
    }
    Ok(())
}

#[napi]
pub fn tool_result(tool_id: f64, result_json: String) -> napi::Result<()> {
    // Notify Swift via the result callback
    unsafe {
        let tool_id_u64 = tool_id as u64;
        let c_result = CString::new(result_json.clone()).unwrap();
        apple_ai_tool_result_callback(tool_id_u64, c_result.as_ptr());
    }

    // Also notify our internal Rust channel for the blocking wait
    if let Some(sender) = tool_results().lock().unwrap().remove(&(tool_id as u64)) {
        let _ = sender.send(result_json);
    }
    Ok(())
}

fn ensure_tool_callback_registered() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        apple_ai_register_tool_callback(Some(js_tool_dispatch));
    });
}

extern "C" fn js_tool_dispatch(_tool_id: u64, _args_json: *const c_char) -> *mut c_char {
    ensure_initialized();

    let args_json = unsafe {
        if _args_json.is_null() {
            "{}".to_string()
        } else {
            CStr::from_ptr(_args_json).to_string_lossy().into_owned()
        }
    };

    // Create channel for result
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    tool_results().lock().unwrap().insert(_tool_id, tx);

    // Call JS side async, swallow any error to avoid unwinding across FFI
    if let Some(ref tsfn) = *tool_callback().lock().unwrap() {
        let _ = std::panic::catch_unwind(|| {
            tsfn.call(
                Ok((_tool_id, args_json)),
                ThreadsafeFunctionCallMode::NonBlocking,
            )
        });
    }

    // Wait for result from separate JS callback
    let response = match rx.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(r) => r,
        Err(_) => {
            // remove dangling sender to avoid leak
            tool_results().lock().unwrap().remove(&_tool_id);
            "{}".to_string()
        }
    };
    CString::new(response).unwrap().into_raw()
}

// ---------------- Tool-based generation task ----------------

pub struct GenerateWithToolsTask {
    pub messages_json: String,
    pub tools_json: String,
    pub temperature: f64,
    pub max_tokens: i32,
}

impl napi::Task for GenerateWithToolsTask {
    type Output = String;
    type JsValue = JsString;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        ensure_initialized();
        ensure_tool_callback_registered();
        let c_messages = CString::new(self.messages_json.clone())
            .map_err(|_| napi::Error::from_reason("Messages contained null byte".to_string()))?;
        let c_tools = CString::new(self.tools_json.clone())
            .map_err(|_| napi::Error::from_reason("Tools JSON contained null byte".to_string()))?;
        unsafe {
            let result_ptr = apple_ai_generate_response_with_tools(
                c_messages.as_ptr(),
                c_tools.as_ptr(),
                self.temperature as c_double,
                self.max_tokens as c_int,
            );
            if result_ptr.is_null() {
                return Err(napi::Error::from_reason(
                    "Generation returned null".to_string(),
                ));
            }
            Ok(take_c_string(result_ptr))
        }
    }

    fn resolve(&mut self, env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        env.create_string(&output)
    }
}

#[napi]
pub fn generate_response_with_tools_native(
    messages_json: String,
    tools_json: String,
    #[napi(ts_arg_type = "number | undefined")] temperature: Option<f64>,
    #[napi(ts_arg_type = "number | undefined")] max_tokens: Option<i32>,
) -> napi::Result<AsyncTask<GenerateWithToolsTask>> {
    let task = GenerateWithToolsTask {
        messages_json,
        tools_json,
        temperature: temperature.unwrap_or(0.0),
        max_tokens: max_tokens.unwrap_or(0),
    };
    Ok(AsyncTask::new(task))
}

#[napi]
pub fn unregister_tool_handler(_id: f64) -> napi::Result<()> {
    // No longer needed with new async approach
    Ok(())
}

// tool stream task ----------------

#[napi]
pub fn generate_response_with_tools_stream(
    messages_json: String,
    tools_json: String,
    #[napi(ts_arg_type = "number | undefined")] temperature: Option<f64>,
    #[napi(ts_arg_type = "number | undefined")] max_tokens: Option<i32>,
    callback: JsFunction,
) -> napi::Result<()> {
    ensure_initialized();
    ensure_tool_callback_registered();

    let ts_fn: ThreadsafeFunction<String, ErrorStrategy::CalleeHandled> = callback
        .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<String>| {
            let env = ctx.env;
            let js_string = env.create_string(&ctx.value)?;
            Ok(vec![js_string])
        })?;

    // prepare state similar to existing stream but separate mutex
    struct LocalState {
        tsfn: ThreadsafeFunction<String, ErrorStrategy::CalleeHandled>,
        _messages: CString,
        _tools: CString,
    }

    static STREAM_TOOLS: OnceLock<Mutex<Option<LocalState>>> = OnceLock::new();
    let mutex = STREAM_TOOLS.get_or_init(|| Mutex::new(None));

    let c_messages = CString::new(messages_json)?;
    let c_tools = CString::new(tools_json)?;

    {
        let mut guard = mutex.lock().unwrap();
        *guard = Some(LocalState {
            tsfn: ts_fn.clone(),
            _messages: c_messages.clone(),
            _tools: c_tools.clone(),
        });
    }

    extern "C" fn chunk_cb(ptr: *const c_char) {
        let mutex = STREAM_TOOLS.get().unwrap();
        let mut guard = mutex.lock().unwrap();
        if let Some(state) = guard.as_mut() {
            if ptr.is_null() {
                let _ = state
                    .tsfn
                    .call(Ok(String::new()), ThreadsafeFunctionCallMode::NonBlocking);
                let _ = state.tsfn.clone().abort();
                *guard = None;
                return;
            }
            let slice_owned = unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() };
            let _ = state
                .tsfn
                .call(Ok(slice_owned), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    unsafe {
        apple_ai_generate_response_with_tools_stream(
            c_messages.as_ptr(),
            c_tools.as_ptr(),
            temperature.unwrap_or(0.0) as c_double,
            max_tokens.unwrap_or(0) as c_int,
            chunk_cb,
        );
    }
    Ok(())
}
