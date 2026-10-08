// Stable macOS Keychain client. Rebuild only when this source changes.
// The AES envelope matches Chromium's macOS v10 format, so existing encrypted
// credentials remain readable without migrating or deleting Keychain items.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonCrypto.h>
#include <unistd.h>

#ifndef E1_KEYCHAIN_SERVICE
#define E1_KEYCHAIN_SERVICE "E1 Code Safe Storage"
#endif
#ifndef E1_KEYCHAIN_ACCOUNT
#define E1_KEYCHAIN_ACCOUNT "E1 Code Key"
#endif

static void clearBytes(void *memory, size_t length) {
  volatile unsigned char *bytes = memory;
  while (length--) *bytes++ = 0;
}

static void fail(const char *message) {
  fprintf(stderr, "%s\n", message);
  exit(1);
}

static NSString *hex(NSData *data) {
  NSMutableString *result = [NSMutableString stringWithCapacity:data.length * 2];
  const unsigned char *bytes = data.bytes;
  for (NSUInteger i = 0; i < data.length; i++) [result appendFormat:@"%02x", bytes[i]];
  return result;
}

static void verifyParent(void) {
  SecCodeRef own = NULL, parent = NULL;
  CFDictionaryRef signing = NULL;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &own) != errSecSuccess ||
      SecCodeCopySigningInformation(own, kSecCSSigningInformation, &signing) != errSecSuccess)
    fail("Cannot inspect helper signature.");
  NSArray *certificates = ((__bridge NSDictionary *)signing)[(__bridge id)kSecCodeInfoCertificates];
  if (!certificates.count) fail("Keychain helper must be signed.");
  NSData *der = CFBridgingRelease(SecCertificateCopyData((__bridge SecCertificateRef)certificates[0]));
  unsigned char digest[CC_SHA1_DIGEST_LENGTH];
  CC_SHA1(der.bytes, (CC_LONG)der.length, digest);
  NSString *requirementText = [NSString stringWithFormat:
    @"identifier \"local.aster.desktop\" and certificate leaf = H\"%@\"",
    hex([NSData dataWithBytes:digest length:sizeof(digest)])];
  SecRequirementRef requirement = NULL;
  if (SecRequirementCreateWithString((__bridge CFStringRef)requirementText, kSecCSDefaultFlags, &requirement) != errSecSuccess)
    fail("Cannot construct caller requirement.");
  pid_t pid = getppid();
  NSDictionary *attributes = @{(__bridge id)kSecGuestAttributePid: @(pid)};
  if (pid <= 1 || SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &parent) != errSecSuccess ||
      SecCodeCheckValidity(parent, kSecCSStrictValidate, requirement) != errSecSuccess || getppid() != pid)
    fail("Keychain access requires the signed E1 Code parent application.");
  CFRelease(parent); CFRelease(requirement); CFRelease(signing); CFRelease(own);
}

static NSData *keychainPassword(void) {
  // Only this one application key is accessible. Neither requests nor argv may
  // select arbitrary Keychain items. No credential material is written to disk.
  const char *service = E1_KEYCHAIN_SERVICE, *account = E1_KEYCHAIN_ACCOUNT;
  UInt32 length = 0;
  void *bytes = NULL;
  OSStatus result = SecKeychainFindGenericPassword(NULL, (UInt32)strlen(service), service,
    (UInt32)strlen(account), account, &length, &bytes, NULL);
  if (result == errSecItemNotFound) {
    unsigned char random[16];
    if (SecRandomCopyBytes(kSecRandomDefault, sizeof(random), random) != errSecSuccess) fail("Cannot generate a storage key.");
    NSData *password = [[[NSData dataWithBytes:random length:sizeof(random)] base64EncodedStringWithOptions:0] dataUsingEncoding:NSUTF8StringEncoding];
    result = SecKeychainAddGenericPassword(NULL, (UInt32)strlen(service), service, (UInt32)strlen(account), account,
      (UInt32)password.length, password.bytes, NULL);
    clearBytes(random, sizeof(random));
    if (result == errSecDuplicateItem) return keychainPassword();
    if (result != errSecSuccess) fail("Could not create the application storage key in Keychain.");
    return password;
  }
  if (result != errSecSuccess) fail("Keychain access was denied or cancelled. Allow the E1 Keychain Helper to use E1 Code Safe Storage.");
  NSData *password = [NSData dataWithBytes:bytes length:length];
  if (bytes) { clearBytes(bytes, length); SecKeychainItemFreeContent(NULL, bytes); }
  if (!password.length) fail("The application storage key is empty; it was left unchanged.");
  return password;
}

static NSData *cryptData(NSData *input, NSData *password, BOOL encrypt) {
  unsigned char key[kCCKeySizeAES128], iv[kCCBlockSizeAES128];
  memset(iv, ' ', sizeof(iv));
  const unsigned char salt[] = "saltysalt";
  if (CCKeyDerivationPBKDF(kCCPBKDF2, password.bytes, password.length, salt, sizeof(salt) - 1,
      kCCPRFHmacAlgSHA1, 1003, key, sizeof(key)) != kCCSuccess) fail("Key derivation failed.");
  NSMutableData *output = [NSMutableData dataWithLength:input.length + kCCBlockSizeAES128];
  size_t written = 0;
  CCCryptorStatus result = CCCrypt(encrypt ? kCCEncrypt : kCCDecrypt, kCCAlgorithmAES,
    kCCOptionPKCS7Padding, key, sizeof(key), iv, input.bytes, input.length,
    output.mutableBytes, output.length, &written);
  clearBytes(key, sizeof(key));
  if (result != kCCSuccess) fail("Encrypted value could not be processed; the original value was left unchanged.");
  output.length = written;
  return output;
}

int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc != 1) fail("Arguments are not accepted. Use the private request pipe.");
    verifyParent();
    // Bound input before parsing, without ever printing its contents.
    NSMutableData *raw = [NSMutableData data];
    NSFileHandle *stream = [NSFileHandle fileHandleWithStandardInput];
    while (true) {
      NSData *chunk = [stream readDataOfLength:65536];
      if (!chunk.length) break;
      if (raw.length + chunk.length > 32 * 1024 * 1024) fail("Storage request exceeds the size limit.");
      [raw appendData:chunk];
    }
    NSDictionary *request = [NSJSONSerialization JSONObjectWithData:raw options:0 error:NULL];
    if (![request isKindOfClass:[NSDictionary class]] || ![request[@"data"] isKindOfClass:[NSString class]]) fail("Invalid storage request.");
    NSString *operation = request[@"operation"];
    if ([operation isEqual:@"browser-key"]) {
      NSData *password = keychainPassword();
      NSData *reply = [NSJSONSerialization dataWithJSONObject:@{@"data": [password base64EncodedStringWithOptions:0]} options:0 error:NULL];
      [[NSFileHandle fileHandleWithStandardOutput] writeData:reply];
      return 0;
    }
    if (![operation isEqual:@"encrypt"] && ![operation isEqual:@"decrypt"]) fail("Unknown storage operation.");
    BOOL encrypt = [operation isEqual:@"encrypt"];
    NSData *input = [[NSData alloc] initWithBase64EncodedString:request[@"data"] options:0];
    if (!input) fail("Storage request is not base64 encoded.");
    if (!encrypt) {
      if (input.length < 19 || memcmp(input.bytes, "v10", 3) || (input.length - 3) % 16) fail("Unsupported encrypted value format.");
      input = [input subdataWithRange:NSMakeRange(3, input.length - 3)];
    }
    NSData *result = cryptData(input, keychainPassword(), encrypt);
    if (encrypt) {
      NSMutableData *envelope = [NSMutableData dataWithBytes:"v10" length:3];
      [envelope appendData:result]; result = envelope;
    }
    NSData *reply = [NSJSONSerialization dataWithJSONObject:@{@"data": [result base64EncodedStringWithOptions:0]} options:0 error:NULL];
    [[NSFileHandle fileHandleWithStandardOutput] writeData:reply];
  }
  return 0;
}
