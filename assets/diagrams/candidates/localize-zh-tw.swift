import Foundation
import CoreFoundation

guard CommandLine.arguments.count == 3 else {
    fputs("usage: localize-zh-tw.swift <input.json> <output.json>\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let data = try Data(contentsOf: inputURL)
let json = try JSONSerialization.jsonObject(with: data)

func traditional(_ value: String) -> String {
    let mutable = NSMutableString(string: value)
    CFStringTransform(mutable, nil, "Hans-Hant" as CFString, false)
    return (mutable as String)
        .replacingOccurrences(of: "文件", with: "檔案")
        .replacingOccurrences(of: "用戶", with: "使用者")
        .replacingOccurrences(of: "項目", with: "專案")
        .replacingOccurrences(of: "信息", with: "資訊")
        .replacingOccurrences(of: "默認", with: "預設")
        .replacingOccurrences(of: "軟刪除", with: "軟刪除")
}

func convert(_ value: Any) -> Any {
    if let string = value as? String {
        return traditional(string)
    }
    if let array = value as? [Any] {
        return array.map(convert)
    }
    if let object = value as? [String: Any] {
        return object.mapValues(convert)
    }
    return value
}

let localized = convert(json)
let output = try JSONSerialization.data(withJSONObject: localized, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
try output.write(to: outputURL, options: .atomic)
