#include "GameState.h"

void GameState::addScene(const std::shared_ptr<Scene>& scene) {
    if (scene != nullptr) {
        scenes_[scene->id()] = scene;
    }
}

std::shared_ptr<Scene> GameState::getScene(const std::string& id) const {
    auto it = scenes_.find(id);
    if (it == scenes_.end()) {
        return nullptr;
    }
    return it->second;
}

void GameState::addVariable(const std::string& key, int value) {
    auto it = variables_.find(key);
    if (it == variables_.end()) {
        variables_[key] = value;
    } else {
        it->second += value;
    }
}

void GameState::setVariable(const std::string& key, int value) {
    variables_[key] = value;
}

int GameState::getVariable(const std::string& key, int defaultValue) const {
    auto it = variables_.find(key);
    if (it == variables_.end()) {
        return defaultValue;
    }
    return it->second;
}

void GameState::addCharacter(const std::shared_ptr<Character>& character) {
    if (character != nullptr) {
        characters_[character->name()] = character;
    }
}

std::shared_ptr<Character> GameState::getCharacter(const std::string& name) const {
    auto it = characters_.find(name);
    if (it == characters_.end()) {
        return nullptr;
    }
    return it->second;
}

void GameState::setCurrentScene(const std::string& id) {
    currentSceneId_ = id;
}
