// Run inside Electron: Keychain attributes a new item to its actual process.
// The stable helper supplies the original password through a private pipe.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#ifndef E1_STORAGE_FIXTURE
#include <node_api.h>
#endif

static NSString *storageFailure(NSError **error, NSString *message) {
  if (error) *error = [NSError errorWithDomain:@"E1BrowserStorage" code:1 userInfo:@{NSLocalizedDescriptionKey:message}];
  return nil;
}

NSString *E1PrepareBrowserStorage(NSString *helperPath, NSError **error) {
  SecCodeRef own = NULL;
  CFDictionaryRef signing = NULL;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &own) != errSecSuccess ||
      SecCodeCopySigningInformation(own, kSecCSSigningInformation, &signing) != errSecSuccess)
    return storageFailure(error, @"Cannot inspect browser storage identity.");
  NSData *hash = ((__bridge NSDictionary *)signing)[(__bridge id)kSecCodeInfoUnique];
  NSMutableString *name = [NSMutableString stringWithString:@"E1 Browser "];
  for (NSUInteger i = 0; i < hash.length; i++) [name appendFormat:@"%02x", ((const unsigned char *)hash.bytes)[i]];
  CFRelease(signing); CFRelease(own);
  if (name.length != 51) return storageFailure(error, @"Invalid browser storage identity.");

  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:helperPath];
  task.environment = @{@"PATH":@"/usr/bin:/bin", @"HOME":NSHomeDirectory(), @"LANG":@"en_US.UTF-8"};
  NSPipe *input = [NSPipe pipe], *output = [NSPipe pipe];
  task.standardInput = input; task.standardOutput = output;
  task.standardError = [NSFileHandle fileHandleWithNullDevice];
  if (![task launchAndReturnError:NULL]) return storageFailure(error, @"Cannot start encrypted storage helper.");
  [[input fileHandleForWriting] writeData:[@"{\"operation\":\"browser-key\",\"data\":\"\"}" dataUsingEncoding:NSUTF8StringEncoding]];
  [[input fileHandleForWriting] closeFile];
  NSData *response = [[output fileHandleForReading] readDataToEndOfFile];
  [task waitUntilExit];
  if (task.terminationStatus || response.length > 4096) return storageFailure(error, @"Cannot open encrypted browser storage.");
  NSDictionary *reply = [NSJSONSerialization JSONObjectWithData:response options:0 error:NULL];
  if (![reply isKindOfClass:[NSDictionary class]] || ![reply[@"data"] isKindOfClass:[NSString class]])
    return storageFailure(error, @"Invalid encrypted storage response.");
  NSMutableData *password = [[[NSData alloc] initWithBase64EncodedString:reply[@"data"] options:0] mutableCopy];
  if (!password.length) return storageFailure(error, @"Empty encrypted storage password.");
  NSString *service = [name stringByAppendingString:@" Safe Storage"], *account = [name stringByAppendingString:@" Key"];
  // No cross-process ACL and no system-wide trust changes. Creating the item
  // here makes this exact signed build its owner. The password stays constant.
  OSStatus status = SecKeychainAddGenericPassword(NULL, (UInt32)strlen(service.UTF8String), service.UTF8String,
    (UInt32)strlen(account.UTF8String), account.UTF8String, (UInt32)password.length, password.bytes, NULL);
  BOOL success = status == errSecSuccess;
  if (status == errSecDuplicateItem) {
    Boolean interaction = true;
    SecKeychainGetUserInteractionAllowed(&interaction);
    SecKeychainSetUserInteractionAllowed(false);
    UInt32 length = 0; void *bytes = NULL;
    status = SecKeychainFindGenericPassword(NULL, (UInt32)strlen(service.UTF8String), service.UTF8String,
      (UInt32)strlen(account.UTF8String), account.UTF8String, &length, &bytes, NULL);
    SecKeychainSetUserInteractionAllowed(interaction);
    success = status == errSecSuccess && length == password.length;
    if (success) {
      unsigned char difference = 0;
      for (NSUInteger i = 0; i < length; i++) difference |= ((unsigned char *)bytes)[i] ^ ((const unsigned char *)password.bytes)[i];
      success = difference == 0;
    }
    if (bytes) { memset_s(bytes, length, 0, length); SecKeychainItemFreeContent(NULL, bytes); }
  }
  memset_s(password.mutableBytes, password.length, 0, password.length);
  if (!success) return storageFailure(error, @"Browser storage identity conflicts with an existing item; no existing data was changed.");
  return name;
}

#ifndef E1_STORAGE_FIXTURE
static napi_value prepare(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t argc = 1; napi_value argv[1];
    if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1) return NULL;
    size_t length = 0;
    if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &length) != napi_ok || !length || length > 16384) {
      napi_throw_type_error(env, NULL, "Expected a helper executable path."); return NULL;
    }
    char *path = calloc(length + 1, 1);
    napi_get_value_string_utf8(env, argv[0], path, length + 1, &length);
    NSString *helper = [NSString stringWithUTF8String:path]; free(path);
    NSError *error = nil;
    NSString *name = E1PrepareBrowserStorage(helper, &error);
    if (!name) { napi_throw_error(env, NULL, error.localizedDescription.UTF8String); return NULL; }
    napi_value result; napi_create_string_utf8(env, name.UTF8String, NAPI_AUTO_LENGTH, &result); return result;
  }
}
NAPI_MODULE_INIT() {
  napi_value function; napi_create_function(env, "prepare", NAPI_AUTO_LENGTH, prepare, NULL, &function);
  napi_set_named_property(env, exports, "prepare", function); return exports;
}
#endif
