#include "Scene.h"

Scene::Scene(const std::string& id) : id_(id) {}

void Scene::addDialogue(const Dialogue& dialogue) {
    dialogues_.push_back(dialogue);
}

void Scene::addDialogue(const std::string& name, const std::string& text) {
    dialogues_.emplace_back(name, text);
}

void Scene::addChoice(const Choice& choice) {
    choices_.push_back(choice);
}
