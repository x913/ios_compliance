#import "MonitorUtils.h"
#import <UIKit/UIKit.h>
#import <AdSupport/AdSupport.h>
#import <Photos/Photos.h>
#import <Contacts/Contacts.h>
#import <CoreLocation/CoreLocation.h>

// 新增函数声明，解决编译报错
@interface NSURLSession (Monitor)
- (NSDictionary *)captureRequestDetails:(NSURLRequest *)request;
- (NSDictionary *)captureDetailsFromURL:(NSURL *)url method:(NSString *)method;
- (NSDictionary *)captureResponseDetails:(NSURLResponse *)response body:(NSData *)body error:(NSError *)error requestID:(NSString *)requestID;
@end


// =======================================================
// 网络监控
// =======================================================
%hook NSURLSession

// 监控带 completionHandler 的请求
- (NSURLSessionDataTask *)dataTaskWithRequest:(NSURLRequest *)request completionHandler:(void (^)(NSData *data, NSURLResponse *response, NSError *error))completionHandler {
    
    // 过滤掉上报日志本身的请求，防止无限循环
    if (request.URL && [request.URL.absoluteString containsString:@"/api/report_log"]) {
        return %orig;
    }

    // 提取数据并记录
    NSDictionary *logData = [self captureRequestDetails:request];
    [MonitorUtils sendLog:logData];

    if (!completionHandler) return %orig;
    NSString *requestID = logData[@"request_id"];
    void (^wrappedCompletionHandler)(NSData *, NSURLResponse *, NSError *) = ^(NSData *data, NSURLResponse *response, NSError *error) {
        [MonitorUtils sendLog:[self captureResponseDetails:response body:data error:error requestID:requestID]];
        if (completionHandler) completionHandler(data, response, error);
    };

    return %orig(request, wrappedCompletionHandler);
}

// 监控不带 completionHandler 的请求 
- (NSURLSessionDataTask *)dataTaskWithRequest:(NSURLRequest *)request {
    if (request.URL && [request.URL.absoluteString containsString:@"/api/report_log"]) {
        return %orig;
    }

    NSDictionary *logData = [self captureRequestDetails:request];
    [MonitorUtils sendLog:logData];

    return %orig;
}

// 监控 dataTaskWithURL:completionHandler:
- (NSURLSessionDataTask *)dataTaskWithURL:(NSURL *)url completionHandler:(void (^)(NSData *data, NSURLResponse *response, NSError *error))completionHandler {
    
    // 过滤掉上报日志本身的请求
    if (url && [url.absoluteString containsString:@"/api/report_log"]) {
        return %orig;
    }

    // 获取函数请求内容 
    NSDictionary *logData = [self captureDetailsFromURL:url method:@"GET"];
    [MonitorUtils sendLog:logData];

    if (!completionHandler) return %orig;
    NSString *requestID = logData[@"request_id"];
    void (^wrappedCompletionHandler)(NSData *, NSURLResponse *, NSError *) = ^(NSData *data, NSURLResponse *response, NSError *error) {
        [MonitorUtils sendLog:[self captureResponseDetails:response body:data error:error requestID:requestID]];
        if (completionHandler) completionHandler(data, response, error);
    };

    return %orig(url, wrappedCompletionHandler);
}

// 监控 dataTaskWithURL
- (NSURLSessionDataTask *)dataTaskWithURL:(NSURL *)url {
    if (url && [url.absoluteString containsString:@"/api/report_log"]) {
        return %orig;
    }
    // 获取函数请求内容 
    NSDictionary *logData = [self captureDetailsFromURL:url method:@"GET"];
    [MonitorUtils sendLog:logData];

    return %orig;
}

// 获取函数请求内容 
%new
- (NSDictionary *)captureDetailsFromURL:(NSURL *)url method:(NSString *)method {
    NSMutableDictionary *dict = [NSMutableDictionary dictionary];
    
    dict[@"type"] = @"network";
    dict[@"request_id"] = [NSUUID UUID].UUIDString;
    dict[@"method"] = method ?: @"GET";
    dict[@"url"] = url.absoluteString ?: @"";
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    [formatter setDateFormat:@"yyyy/MM/dd, HH:mm:ss"];
    dict[@"timestamp"] = [formatter stringFromDate:[NSDate date]];

    // 获取 Header 数据
    NSMutableDictionary *finalHeaders = [NSMutableDictionary dictionary];
    if ([self respondsToSelector:@selector(configuration)]) {
        NSDictionary *configHeaders = self.configuration.HTTPAdditionalHeaders;
        if (configHeaders && configHeaders.count > 0) {
            [finalHeaders addEntriesFromDictionary:configHeaders];
        }
    }

    // 如果有 Header 数据则写入，没有则不写
    if (finalHeaders.count > 0) {
        dict[@"headers"] = finalHeaders;
    }
    // dataTaskWithURL 通常没有 Body
    dict[@"body"] = @"";
    
    return dict;
}


// 提取请求详情
%new
- (NSDictionary *)captureRequestDetails:(NSURLRequest *)request {
    NSMutableDictionary *dict = [NSMutableDictionary dictionary];
    
    // 基础信息
    dict[@"type"] = @"network";
    dict[@"request_id"] = [NSUUID UUID].UUIDString;
    dict[@"method"] = request.HTTPMethod ?: @"GET";
    dict[@"url"] = request.URL.absoluteString ?: @"";

    // 1. 获取当前时间戳 (格式: YYYY/MM/DD, HH:MM:SS)
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    [formatter setDateFormat:@"yyyy/MM/dd, HH:mm:ss"];
    dict[@"timestamp"] = [formatter stringFromDate:[NSDate date]];

    // 2. 获取 Headers
    if (request.allHTTPHeaderFields) {
        dict[@"headers"] = request.allHTTPHeaderFields;
    }

    // 3. 获取 Body
    if (request.HTTPBody) {
        NSString *bodyString = [[NSString alloc] initWithData:request.HTTPBody encoding:NSUTF8StringEncoding];
        if (bodyString) {
            dict[@"body"] = bodyString;
        } else {
            dict[@"body"] = [NSString stringWithFormat:@"[Binary Data] Length: %lu", (unsigned long)request.HTTPBody.length];
        }
    } else if (request.HTTPBodyStream) {
        dict[@"body"] = @"[Stream Body - Not Captured]";
    }
    return dict;
}

%new
- (NSDictionary *)captureResponseDetails:(NSURLResponse *)response body:(NSData *)body error:(NSError *)error requestID:(NSString *)requestID {
    NSMutableDictionary *dict = [NSMutableDictionary dictionary];
    dict[@"type"] = @"network_response";
    dict[@"request_id"] = requestID ?: @"";
    dict[@"url"] = response.URL.absoluteString ?: @"";

    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    [formatter setDateFormat:@"yyyy/MM/dd, HH:mm:ss"];
    dict[@"timestamp"] = [formatter stringFromDate:[NSDate date]];

    if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
        NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
        dict[@"status_code"] = @(httpResponse.statusCode);
        if (httpResponse.allHeaderFields) dict[@"headers"] = httpResponse.allHeaderFields;
    }

    if (error) dict[@"error"] = error.localizedDescription ?: @"Request failed";

    if (body.length > 256 * 1024) {
        dict[@"body"] = [NSString stringWithFormat:@"[Body omitted: %lu bytes exceeds 262144-byte limit]", (unsigned long)body.length];
    } else if (body) {
        NSString *bodyString = [[NSString alloc] initWithData:body encoding:NSUTF8StringEncoding];
        dict[@"body"] = bodyString ?: [NSString stringWithFormat:@"[Binary data: %lu bytes]", (unsigned long)body.length];
    } else {
        dict[@"body"] = @"";
    }

    return dict;
}

%end

// =======================================================
// 剪切板监控
// =======================================================
%hook _UIConcretePasteboard
- (NSString *)string {
    NSString *res = %orig;
    [MonitorUtils reportLogWithCategory:@"Pasteboard"
                                   func:@"[UIPasteboard string]" 
                                content:res 
                            methodDesc:@"读取剪切板内容"];
    return res;
}
- (void)setString:(NSString *)string {
    %orig;
    [MonitorUtils reportLogWithCategory:@"Pasteboard"
                                   func:@"[UIPasteboard setString]" 
                                content:string 
                             methodDesc:@"写入剪切板内容"];
}
- (NSURL *)URL {
    NSURL *res = %orig;
    [MonitorUtils reportLogWithCategory:@"Pasteboard"
                                   func:@"[UIPasteboard URL]" 
                                content:res 
                             methodDesc:@"读取剪切板URL"];
    return res;
}
- (void)setURL:(NSURL *)url {
    %orig;
    [MonitorUtils reportLogWithCategory:@"Pasteboard"
                                   func:@"[UIPasteboard setURL]" 
                                content:url 
                             methodDesc:@"写入剪切板URL"];
}
- (NSArray *)items {
    NSArray *res = %orig;
    // 使用 %@ 获取数组详细内容的字符串表示
    NSString *contentStr = [NSString stringWithFormat:@"%@", res ? res : @"nil"];
    
    [MonitorUtils reportLogWithCategory:@"Pasteboard"
                                   func:@"[UIPasteboard items]" 
                                content:contentStr 
                             methodDesc:@"读取剪切板内容"];
    return res;
}

- (void)setItems:(NSArray *)items {
    %orig;
    // 同理，修改 setItems
    NSString *contentStr = [NSString stringWithFormat:@"%@", items ? items : @"nil"];
    
    [MonitorUtils reportLogWithCategory:@"Pasteboard"
                                   func:@"[UIPasteboard setItems]" 
                                content:contentStr 
                             methodDesc:@"写入剪切板内容"];
}
%end

// =======================================================
// 相册访问监控
// =======================================================
%hook PHPhotoLibrary
+ (PHPhotoLibrary *)sharedPhotoLibrary {
    PHPhotoLibrary *library = %orig;
    [MonitorUtils reportLogWithCategory:@"PhotoLibrary" 
                                   func:@"[PHPhotoLibrary sharedPhotoLibrary]" 
                                content:@"已访问共享照片库实例" 
                             methodDesc:@"获取照片库"];
    return library;
}

// iOS 14 以下权限申请监控
+ (void)requestAuthorization:(void (^)(PHAuthorizationStatus status))handler {
    [MonitorUtils reportLogWithCategory:@"PhotoLibrary" 
                                   func:@"[PHPhotoLibrary requestAuthorization]" 
                                content:@"申请相册权限" 
                             methodDesc:@"获取相册权限"];
    %orig;
}

// iOS 14+ 权限申请监控 
+ (void)requestAuthorizationForAccessLevel:(NSInteger)accessLevel handler:(void (^)(PHAuthorizationStatus status))handler {
    // accessLevel: 1 为 AddOnly(仅允许添加), 2 为 ReadWrite(读写)
    NSString *levelStr = (accessLevel == 2) ? @"读写权限" : @"仅添加权限";
    NSString *logContent = [NSString stringWithFormat:@"申请相册%@ (iOS 14+ API)", levelStr];

    [MonitorUtils reportLogWithCategory:@"PhotoLibrary" 
                                   func:@"[PHPhotoLibrary requestAuthorizationForAccessLevel:handler:]" 
                                content:logContent 
                             methodDesc:@"获取相册权限"];
    %orig;
}

- (void)performChanges:(void (^)(void))changeBlock completionHandler:(void (^)(BOOL success, NSError *error))completionHandler {
    [MonitorUtils reportLogWithCategory:@"PhotoLibrary" 
                                   func:@"[PHPhotoLibrary performChanges:completionHandler]" 
                                content:@"正在尝试异步修改相册内容" 
                             methodDesc:@"修改相册内容"];
    %orig;
}

- (void)performChangesAndWait:(void (^)(void))changeBlock error:(NSError **)error {
    [MonitorUtils reportLogWithCategory:@"PhotoLibrary" 
                                   func:@"[PHPhotoLibrary performChangesAndWait:error]" 
                                content:@"正在尝试同步修改相册内容" 
                             methodDesc:@"修改相册内容"];
    %orig;
}

%end

//%hook PHAsset
//
// // 根据连拍标识符获取照片
// + (PHFetchResult *)fetchAssetsWithBurstIdentifier:(NSString *)burstIdentifier options:(id)options {
//     [MonitorUtils reportLogWithCategory:@"PhotoLibrary" 
//                                    func:@"[PHAsset fetchAssetsWithBurstIdentifier:options]" 
//                                 content:[NSString stringWithFormat:@"连拍组 ID: %@", burstIdentifier] 
//                              methodDesc:@"获取照片"];
//     return %orig;
// }

// // 获取特定相册中的照片资源
// + (PHFetchResult *)fetchAssetsInAssetCollection:(id)assetCollection options:(id)options {
//     [MonitorUtils reportLogWithCategory:@"PhotoLibrary" 
//                                    func:@"[PHAsset fetchAssetsInAssetCollection:options]" 
//                                 content:[NSString stringWithFormat:@"相册集合对象: %@", assetCollection] 
//                              methodDesc:@"获取照片"];
//     return %orig;
// }

// // 获取符合条件的所有照片/视频资源
// + (PHFetchResult *)fetchAssetsWithOptions:(id)options {
//     [MonitorUtils reportLogWithCategory:@"PhotoLibrary" 
//                                    func:@"[PHAsset fetchAssetsWithOptions]" 
//                                 content:@"正在检索所有符合配置条件的资源" 
//                              methodDesc:@"检索相册"];
//     return %orig;
// }

// // 获取修改后的图像数据
// - (NSData *)adjustedImageData {
//     [MonitorUtils reportLogWithCategory:@"照片库" 
//                                    func:@"[PHAsset adjustedImageData]" 
//                                 content:[NSString stringWithFormat:@"资源对象: %@", self] 
//                              methodDesc:@"读取照片"];
//     return %orig;
// }

// // 获取本地视频文件的 URL 路径
// - (NSURL *)localVideoURL {
//     [MonitorUtils reportLogWithCategory:@"照片库" 
//                                    func:@"[PHAsset localVideoURL]" 
//                                 content:[NSString stringWithFormat:@"资源对象: %@", self] 
//                              methodDesc:@"获取视频路径"];
//     return %orig;
// }

// %end

// =======================================================
// 通讯录访问监控
// =======================================================
%hook CNContactStore

// 请求访问权限
- (void)requestAccessForEntityType:(CNEntityType)entityType completionHandler:(void (^)(BOOL granted, NSError *error))completionHandler {
    NSString *entityTypeStr = (entityType == CNEntityTypeContacts) ? @"联系人" : @"未知类型";
    [MonitorUtils reportLogWithCategory:@"Contacts" 
                                   func:@"[CNContactStore requestAccessForEntityType:completionHandler]" 
                                content:[NSString stringWithFormat:@"正在请求访问权限类型: %@", entityTypeStr] 
                             methodDesc:@"申请通讯录访问权限"];
    %orig;
}

// 查询当前的权限状态
- (CNAuthorizationStatus)authorizationStatusForEntityType:(CNEntityType)entityType {
    NSString *entityTypeStr = (entityType == CNEntityTypeContacts) ? @"联系人" : @"未知类型";
    CNAuthorizationStatus status = %orig;
    [MonitorUtils reportLogWithCategory:@"Contacts" 
                                   func:@"[CNContactStore authorizationStatusForEntityType]" 
                                content:[NSString stringWithFormat:@"当前授权状态码: %ld (类型: %@)", (long)status, entityTypeStr] 
                             methodDesc:@"查询通讯录授权状态"];
    return status;
}

// 匹配条件查询联系人（最常用的获取联系人列表方法）
- (NSArray *)unifiedContactsMatchingPredicate:(id)predicate keysToFetch:(NSArray *)keys error:(NSError **)error {
    [MonitorUtils reportLogWithCategory:@"Contacts" 
                                   func:@"[CNContactStore unifiedContactsMatchingPredicate:keysToFetch:error]" 
                                content:@"App 正在通过特定搜索条件检索联系人列表" 
                             methodDesc:@"获取联系人"];
    return %orig;
}

// 通过唯一标识符查询联系人
- (NSArray *)unifiedContactsWithIdentifiers:(NSArray *)identifiers keysToFetch:(NSArray *)keys error:(NSError **)error {
    [MonitorUtils reportLogWithCategory:@"Contacts" 
                                   func:@"[CNContactStore unifiedContactsWithIdentifiers:keysToFetch:error]" 
                                content:[NSString stringWithFormat:@"正在通过 ID 检索联系人，目标数量: %lu", (unsigned long)identifiers.count] 
                             methodDesc:@"获取联系人"];
    return %orig;
}

// 查询联系人分组
- (NSArray *)groupsMatchingPredicate:(id)predicate error:(NSError **)error {
    [MonitorUtils reportLogWithCategory:@"Contacts" 
                                   func:@"[CNContactStore groupsMatchingPredicate:error]" 
                                content:@"正在读取通讯录的分组信息（如“家人”、“工作”）" 
                             methodDesc:@"获取联系人"];
    return %orig;
}

// 查询联系人容器（如 iCloud、Gmail 存储等）
- (NSArray *)containersMatchingPredicate:(id)predicate error:(NSError **)error {
    [MonitorUtils reportLogWithCategory:@"Contacts" 
                                   func:@"[CNContactStore containersMatchingPredicate:error]" 
                                content:@"正在查询联系人的存储容器来源" 
                             methodDesc:@"获取联系人"];
    return %orig;
}

%end

// =======================================================
// 位置信息监控
// =======================================================
%hook CLLocationManager

// 请求权限
- (void)requestWhenInUseAuthorization {
    [MonitorUtils reportLogWithCategory:@"Location" 
                                   func:@"[CLLocationManager requestWhenInUseAuthorization]" 
                                content:@"App 正在申请“仅在使用期间”访问位置的权限" 
                             methodDesc:@"申请定位权限"];
    %orig;
}

// 请求权限
- (void)requestAlwaysAuthorization {
    [MonitorUtils reportLogWithCategory:@"Location" 
                                   func:@"[CLLocationManager requestAlwaysAuthorization]" 
                                content:@"App 正在申请“始终访问”位置的权限" 
                             methodDesc:@"申请定位权限"];
    %orig;
}

// 启动高精定位
- (void)startUpdatingLocation {
    [MonitorUtils reportLogWithCategory:@"Location" 
                                   func:@"[CLLocationManager startUpdatingLocation]" 
                                content:@"App 已启动持续定位" 
                             methodDesc:@"启动实时定位"];
    %orig;
}

// 启动位置监控
- (void)startMonitoringSignificantLocationChanges {
    [MonitorUtils reportLogWithCategory:@"Location" 
                                   func:@"[CLLocationManager startMonitoringSignificantLocationChanges]" 
                                content:@"App 已启动基于基站/Wi-Fi位置变化监控" 
                             methodDesc:@"启动定位"];
    %orig;
}

// 启动地理围栏监控
- (void)startMonitoringForRegion:(id)region {
    [MonitorUtils reportLogWithCategory:@"Location" 
                                   func:@"[CLLocationManager startMonitoringForRegion]" 
                                content:[NSString stringWithFormat:@"正在监控地理围栏: %@", region] 
                             methodDesc:@"启动地理围栏监控"];
    %orig;
}

// 允许延迟定位更新
- (void)allowDeferredLocationUpdatesUntilTraveled:(double)distance timeout:(double)timeout {
    NSString *info = [NSString stringWithFormat:@"位移 %.2f 米，超时时间 %.2f 秒", distance, timeout];
    [MonitorUtils reportLogWithCategory:@"Location" 
                                   func:@"[CLLocationManager allowDeferredLocationUpdates...]" 
                                content:info 
                             methodDesc:@"配置延迟位置更新"];
    %orig;
}

%end

// =======================================================
//  设备标识 (IDFA/IDFV) 
// =======================================================
%hook ASIdentifierManager
- (NSUUID *)advertisingIdentifier {
    NSUUID *uuid = %orig;
    [MonitorUtils reportLogWithCategory:@"IDFA" 
                                   func:@"[ASIdentifierManager advertisingIdentifier]" 
                                content:uuid.UUIDString 
                             methodDesc:@"获取IDFA"];
    return uuid;
}
%end

%hook UIDevice

- (NSUUID *)identifierForVendor {

    NSUUID *uuid = %orig;
    [MonitorUtils reportLogWithCategory:@"IDFV" 
                                   func:@"[UIDevice identifierForVendor]" 
                                content:uuid.UUIDString 
                             methodDesc:@"获取IDFV"];
    return uuid;
}
// - (NSString *)name {
//     NSString *res = %orig;
//     [MonitorUtils reportLogWithCategory:@"Name" 
//                                    func:@"[UIDevice name]" 
//                                 content:res 
//                             methodDesc:@"获取设备名称"];
//     return res;
// }
// - (NSString *)systemVersion {
//     NSString *res = %orig;
//     [MonitorUtils reportLogWithCategory:@"Version" 
//                                    func:@"[UIDevice systemVersion]" 
//                                 content:res 
//                             methodDesc:@"获取系统版本号"];
//     return res;
// }
%end
