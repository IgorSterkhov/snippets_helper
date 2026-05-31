package com.snippetshelper

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

class IsterAppInfoModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "IsterAppInfo"

  override fun getConstants(): MutableMap<String, Any> {
    return mutableMapOf(
      "versionCode" to BuildConfig.VERSION_CODE,
      "versionName" to BuildConfig.VERSION_NAME,
    )
  }
}
