# Integración Frontend-Backend para Internacionalización (i18n)

## Resumen

El sistema de internacionalización soporta **inglés (en)**, **español (es)** y **holandés (nl)** con detección automática de idioma y persistencia de preferencias del usuario.

## 🎯 Estrategia de Sincronización

### 1. **Preferencia Persistente (Recomendado)**
El usuario guarda su idioma preferido en su perfil y el backend lo usa automáticamente.

### 2. **Header Temporal (Opcional)**
Para cambios temporales de idioma sin guardar en el perfil.

## 📡 API Endpoints

### Actualizar Preferencia de Idioma
```http
PUT /api/auth/language
Authorization: Bearer <token>
Content-Type: application/json

{
  "language": "es"
}
```

**Respuesta:**
```json
{
  "status": "success",
  "message": "Preferencia de idioma actualizada exitosamente",
  "data": {
    "preferredLanguage": "es"
  }
}
```

### Obtener Perfil del Usuario
```http
GET /api/auth/me
Authorization: Bearer <token>
```

**Respuesta incluye:**
```json
{
  "status": "success",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "preferredLanguage": "es",
      // ... otros campos
    }
  }
}
```

## 🔧 Configuración Frontend

### Opción 1: Solo Preferencia Persistente (Más Simple)

```javascript
// Al hacer login, obtener el idioma del usuario
const loginUser = async (credentials) => {
  const loginResponse = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
  });

  if (loginResponse.ok) {
    // Obtener perfil completo con idioma
    const profileResponse = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const profile = await profileResponse.json();
    const userLanguage = profile.data.user.preferredLanguage || 'en';

    // Configurar idioma en la app
    setAppLanguage(userLanguage);
  }
};

// Cambiar idioma permanentemente
const changeLanguage = async (newLanguage) => {
  const response = await fetch('/api/auth/language', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ language: newLanguage })
  });

  if (response.ok) {
    setAppLanguage(newLanguage);
  }
};
```

### Opción 2: Con Header Temporal (Más Flexible)

```javascript
// Configurar interceptor global para enviar idioma actual
const apiClient = axios.create({
  baseURL: '/api'
});

apiClient.interceptors.request.use((config) => {
  const currentLanguage = getCurrentAppLanguage(); // 'en', 'es', 'nl'

  config.headers['X-Locale'] = currentLanguage;

  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }

  return config;
});

// Cambio temporal de idioma (sin guardar)
const changeLanguageTemporarily = (newLanguage) => {
  setAppLanguage(newLanguage);
  // Las próximas requests usarán el nuevo idioma via X-Locale header
};

// Guardar idioma permanentemente
const saveLanguagePreference = async (language) => {
  await apiClient.put('/auth/language', { language });
  setAppLanguage(language);
};
```

## 🧭 Detección Automática de Idioma

El backend detecta el idioma en este orden de prioridad:

1. **Query parameter**: `?lang=es`
2. **Header personalizado**: `X-Locale: es`
3. **Preferencia del usuario**: `user.preferredLanguage` (si está autenticado)
4. **Accept-Language del navegador**: `Accept-Language: es-ES,es;q=0.9`
5. **Default**: `en` (inglés)

## 🎨 Ejemplo Flutter

```dart
class ApiService {
  static const String baseUrl = 'http://your-api.com/api';

  // Obtener idioma guardado
  Future<String> getUserLanguage() async {
    final response = await http.get(
      Uri.parse('$baseUrl/auth/me'),
      headers: {'Authorization': 'Bearer $token'},
    );

    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return data['data']['user']['preferredLanguage'] ?? 'en';
    }
    return 'en';
  }

  // Cambiar idioma permanentemente
  Future<bool> updateLanguage(String language) async {
    final response = await http.put(
      Uri.parse('$baseUrl/auth/language'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: json.encode({'language': language}),
    );

    return response.statusCode == 200;
  }

  // Hacer request con idioma temporal
  Future<http.Response> makeRequest(String endpoint, {String? tempLanguage}) async {
    Map<String, String> headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };

    if (tempLanguage != null) {
      headers['X-Locale'] = tempLanguage;
    }

    return await http.get(
      Uri.parse('$baseUrl$endpoint'),
      headers: headers,
    );
  }
}

// Uso en la app
class LanguageController extends GetxController {
  final RxString currentLanguage = 'en'.obs;
  final ApiService _apiService = ApiService();

  @override
  void onInit() async {
    super.onInit();
    // Cargar idioma guardado al iniciar
    currentLanguage.value = await _apiService.getUserLanguage();
    Get.updateLocale(Locale(currentLanguage.value));
  }

  Future<void> changeLanguage(String newLanguage, {bool permanent = true}) async {
    if (permanent) {
      final success = await _apiService.updateLanguage(newLanguage);
      if (success) {
        currentLanguage.value = newLanguage;
        Get.updateLocale(Locale(newLanguage));
      }
    } else {
      // Cambio temporal, solo en la app
      currentLanguage.value = newLanguage;
      Get.updateLocale(Locale(newLanguage));
    }
  }
}
```

## 📋 Lista de Idiomas Soportados

| Código | Idioma | Nombre Local |
|--------|--------|--------------|
| `en` | English | English |
| `es` | Español | Español |
| `nl` | Nederlands | Nederlands |

## ⚡ Mejores Prácticas

### 1. **Inicialización de la App**
```javascript
// Al iniciar la app
const initializeApp = async () => {
  if (isUserLoggedIn()) {
    const userProfile = await fetchUserProfile();
    const savedLanguage = userProfile.preferredLanguage || 'en';
    setAppLanguage(savedLanguage);
  } else {
    // Usuario no logueado: usar idioma del navegador
    const browserLanguage = getBrowserLanguage(); // 'en', 'es', 'nl'
    setAppLanguage(browserLanguage);
  }
};
```

### 2. **Intercambio de Idioma en Configuraciones**
```javascript
const LanguageSelector = () => {
  const handleLanguageChange = async (newLanguage) => {
    // Mostrar loading
    setLoading(true);

    try {
      // Guardar en backend si está logueado
      if (isUserLoggedIn()) {
        await updateUserLanguage(newLanguage);
      }

      // Actualizar app
      setAppLanguage(newLanguage);

      // Opcional: recargar datos para obtener textos actualizados
      await refetchUserData();
    } catch (error) {
      showError('Error updating language');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Select onChange={handleLanguageChange}>
      <Option value="en">🇺🇸 English</Option>
      <Option value="es">🇪🇸 Español</Option>
      <Option value="nl">🇳🇱 Nederlands</Option>
    </Select>
  );
};
```

### 3. **Validación de Errores**
```javascript
// El backend retorna errores en el idioma configurado
const handleApiError = (error) => {
  // Los mensajes ya vienen traducidos del backend
  const message = error.response.data.message;
  showNotification(message, 'error');
};
```

## 🔍 Testing

### Probar Cambio de Idioma
```bash
# Cambiar a español
curl -X PUT http://localhost:3000/api/auth/language \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"language": "es"}'

# Probar endpoint con idioma temporal
curl -X GET http://localhost:3000/api/receipts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Locale: nl"

# Probar con query parameter
curl -X GET "http://localhost:3000/api/receipts?lang=es" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 🚨 Consideraciones Importantes

1. **Fallback**: Siempre tiene fallback a inglés si falla la detección
2. **Validación**: Solo acepta `en`, `es`, `nl`
3. **Persistencia**: La preferencia se guarda en la base de datos
4. **Performance**: Los prompts de AI están optimizados en inglés para mejor comprensión
5. **Headers**: `X-Locale` es opcional y temporal, `preferredLanguage` es persistente

¡Con esta implementación tendrás un sistema de i18n robusto y fácil de usar desde cualquier frontend! 🌍