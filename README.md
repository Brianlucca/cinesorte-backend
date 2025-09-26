# CineSorte - Backend

This is the backend server repository for the CineSorte application. This REST API is built with Node.js and Express, and its main responsibility is to serve as a secure and efficient bridge between the frontend (built in React) and external services, such as Firebase for authentication and The Movie Database (TMDb) for movie and series data.

## ✨ Key Features

The backend is designed to be robust and secure, offering the following functionalities:

* **User Authentication:** A complete registration and login system using Firebase Authentication to ensure user data security.
* **Session Management:** Uses `httpOnly` and `secure` cookies to manage user sessions securely, protecting against XSS attacks.
* **Custom Lists API:** Provides CRUD (Create, Read, Delete) endpoints for users to save and manage their custom lists of movies and series. Data is persisted in the Firestore database.
* **Proxy for TMDb API:** Acts as an intermediary for The Movie Database API. This protects your TMDb API key by keeping it secure on the server and preventing its exposure on the client side.
* **Security and Optimization:**
    * **Rate Limiting:** Implements a request limiter (`express-rate-limit`) to protect API routes from abuse and ensure your TMDb key is not blocked.
    * **Security Headers:** Uses `helmet` to set various HTTP security headers, protecting the application against known web vulnerabilities.
    * **Configured CORS:** Allows requests only from your frontend domain, ensuring that only your application can access the API.

## 🛠️ Technologies Used

* **Node.js:** Server-side JavaScript runtime environment.
* **Express.js:** Minimalist framework for building the API.
* **Firebase Admin SDK:** For integration with Authentication and Firestore services.
* **Axios:** HTTP client for making requests to the external TMDb API.
* **CORS:** Middleware for managing cross-origin permissions.
* **Helmet:** Middleware for setting security headers.
* **`express-rate-limit`:** Middleware for request limiting.
* **`cookie-parser`:** Middleware for handling cookies.
* **`dotenv`:** For managing environment variables.

## 📂 API Architecture

The API is structured in a modular way to promote separation of concerns and maintainability.

* **`/routes`:** Defines the API endpoints (e.g., `/users`, `/tmdb`) and maps them to their respective controllers.
* **`/controllers`:** Contains all the business logic. Each controller is responsible for processing requests, interacting with services (like Firebase or TMDb), and sending the response.
* **`/middleware`:** Contains application middleware, such as authentication token verification (`verifyToken`) and the request limiter (`rateLimiter`).
* **`/config`:** Centralizes the configuration of external services, such as Firebase initialization.
